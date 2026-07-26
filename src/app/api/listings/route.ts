import { NextResponse } from 'next/server';

import { prisma } from '../../../db/client';
import { requireCapability, toErrorResponse } from '../../../lib/session';
import { ListingError, publishListing } from '../../../services/listing-service';
import { fanOutListing } from '../../../services/match-worker';
import { PhotoError, assessPhotos, storeListingPhotos } from '../../../services/photo-service';

/**
 * Publish a listing.
 *
 * Multipart, because photos come straight from a phone camera in the same
 * submission — a separate upload round trip is one more thing to fail on a
 * connection that is already marginal.
 */
export async function POST(request: Request) {
  // Session-derived, never client-supplied. The tier gate runs server-side
  // against the user's live tier — a client that claims T2 gets a 403.
  let sellerId: string;
  try {
    const user = await requireCapability('CREATE_LISTING');
    sellerId = user.userId;
  } catch (error) {
    const response = toErrorResponse(error);
    if (response) return response;
    throw error;
  }

  let payload: unknown;
  let files: File[] = [];

  try {
    const form = await request.formData();
    const raw = form.get('listing');
    if (typeof raw !== 'string') {
      return NextResponse.json({ message: 'Missing listing data' }, { status: 400 });
    }
    payload = JSON.parse(raw);
    files = form.getAll('photos').filter((f): f is File => f instanceof File);
  } catch {
    return NextResponse.json({ message: 'Could not read the submission' }, { status: 400 });
  }

  // Validated from their own bytes, EXIF read for fraud signals, then stripped
  // so a published photo cannot geolocate the farm (§4.3, §8.3).
  let photos;
  try {
    photos = await storeListingPhotos(files, { sellerId });
  } catch (error) {
    if (error instanceof PhotoError) {
      return NextResponse.json(
        { message: error.message, code: error.reason, photoIndex: error.index },
        { status: error.reason === 'STORAGE_FAILED' ? 502 : 400 },
      );
    }
    throw error;
  }

  const photoUrls = photos.map((photo) => photo.url);

  try {
    const result = await publishListing(prisma, {
      sellerId,
      input: { ...(payload as Record<string, unknown>), photoUrls },
    });

    // Capture-location and staleness signals, recorded against the listing for
    // the trust queue rather than shown to anyone.
    const suspicion = assessPhotos(photos, null);
    if (suspicion.locationMismatchKm !== undefined) {
      await prisma.fraudFlag.create({
        data: {
          kind: 'EXIF_LOCATION_MISMATCH',
          severity: 'SOFT',
          userId: sellerId,
          listingId: result.listingId,
          detail: `Photo captured ${Math.round(suspicion.locationMismatchKm)} km from the farm`,
        },
      });
    }

    // Fan-out belongs on a queue (BullMQ) rather than in the request. A farmer
    // on 2G must not wait for a match sweep across every alert profile.
    // Inline for now, deliberately after the response is computed.
    void fanOutListing(prisma, result.listingId).catch(() => undefined);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ListingError) {
      const status =
        error.code === 'STOLEN_STOCK' || error.code === 'OWNERSHIP_CONFLICT'
          ? 409
          : error.code === 'VERIFICATION_REQUIRED'
            ? 403
            : 400;

      return NextResponse.json(
        { message: error.message, code: error.code, failures: error.failures },
        { status },
      );
    }

    // Never leak internals to a client. The detail belongs in the logs.
    console.error('Listing publish failed', error);
    return NextResponse.json({ message: 'error.generic' }, { status: 500 });
  }
}
