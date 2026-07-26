/**
 * Offline listing drafts, in IndexedDB.
 *
 * MASTER_PROMPT.md §3.5. A farmer creating a listing is standing at a kraal
 * with two bars of signal, photographing animals one at a time. The signal will
 * drop, and when it does the work must still be there.
 *
 * Design rules, all learned from how this goes wrong:
 *   - Save on every change, not on a "save" button. People close browsers.
 *   - Never block the UI on a write. IndexedDB is async; the form is not.
 *   - Keep photos as Blobs in the same record. A draft referencing object URLs
 *     that died with the page is worse than no draft, because it looks intact.
 *   - Queue the publish itself, so pressing Publish with no signal is a promise
 *     rather than an error.
 */

const DB_NAME = 'kraal';
const DB_VERSION = 1;
const DRAFT_STORE = 'listing-drafts';
const QUEUE_STORE = 'publish-queue';

export interface DraftPhoto {
  id: string;
  blob: Blob;
  capturedAt: number;
}

export interface ListingDraft {
  id: string;
  farmId?: string;
  title?: string;
  description?: string;
  priceBasis?: string;
  askingPrice?: number;
  quantity?: number;
  lotSplittable?: boolean;
  minPurchaseQty?: number;
  animals?: Record<string, unknown>[];
  photos: DraftPhoto[];
  updatedAt: number;
  /** Set once queued for publication, so the UI can show "sending". */
  queuedAt?: number;
}

export interface QueuedPublish {
  id: string;
  draftId: string;
  payload: unknown;
  photoIds: string[];
  attempts: number;
  lastError?: string;
  queuedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        store.createIndex('queuedAt', 'queuedAt');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = work(tx.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

/** IndexedDB is unavailable in some private-browsing modes; degrade, don't crash. */
export function isSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function saveDraft(draft: ListingDraft): Promise<void> {
  if (!isSupported()) return;
  const record = { ...draft, updatedAt: Date.now() };
  await run(DRAFT_STORE, 'readwrite', (store) => store.put(record));
}

export async function loadDraft(id: string): Promise<ListingDraft | undefined> {
  if (!isSupported()) return undefined;
  return run<ListingDraft | undefined>(DRAFT_STORE, 'readonly', (store) => store.get(id));
}

export async function listDrafts(): Promise<ListingDraft[]> {
  if (!isSupported()) return [];
  const all = await run<ListingDraft[]>(DRAFT_STORE, 'readonly', (store) => store.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteDraft(id: string): Promise<void> {
  if (!isSupported()) return;
  await run(DRAFT_STORE, 'readwrite', (store) => store.delete(id));
}

/**
 * Queue a publish for when connectivity returns.
 *
 * The draft is deliberately NOT deleted here. It is removed only once the
 * server has confirmed the listing, so a failed send never loses the work.
 */
export async function queuePublish(item: Omit<QueuedPublish, 'attempts' | 'queuedAt'>): Promise<void> {
  if (!isSupported()) return;
  const record: QueuedPublish = { ...item, attempts: 0, queuedAt: Date.now() };
  await run(QUEUE_STORE, 'readwrite', (store) => store.put(record));
}

export async function pendingPublishes(): Promise<QueuedPublish[]> {
  if (!isSupported()) return [];
  const all = await run<QueuedPublish[]>(QUEUE_STORE, 'readonly', (store) => store.getAll());
  return all.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function markAttempted(id: string, error?: string): Promise<void> {
  if (!isSupported()) return;
  const existing = await run<QueuedPublish | undefined>(QUEUE_STORE, 'readonly', (store) =>
    store.get(id),
  );
  if (!existing) return;
  await run(QUEUE_STORE, 'readwrite', (store) =>
    store.put({ ...existing, attempts: existing.attempts + 1, lastError: error }),
  );
}

export async function dequeue(id: string): Promise<void> {
  if (!isSupported()) return;
  await run(QUEUE_STORE, 'readwrite', (store) => store.delete(id));
}

/**
 * Compress a captured photo before it is stored or uploaded.
 *
 * A modern phone camera produces 4–8 MB per frame. Three of those over 2G is
 * several minutes of upload and a meaningful slice of a prepaid data bundle, so
 * this is a cost-of-selling issue rather than a performance nicety.
 */
export async function compressImage(
  file: Blob,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<Blob> {
  const maxEdge = options.maxEdge ?? 1_600;
  const quality = options.quality ?? 0.75;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ?? file),
      'image/webp',
      quality,
    );
  });
}

export function newDraftId(): string {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
