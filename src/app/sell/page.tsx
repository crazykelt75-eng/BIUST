import { ListingForm } from './listing-form';

/**
 * Sell flow shell.
 *
 * The farm is resolved server-side once auth lands; until then it comes from
 * the query string so the flow is exercisable end to end.
 */
export default async function SellPage({
  searchParams,
}: {
  searchParams: Promise<{ farm?: string }>;
}) {
  const { farm } = await searchParams;
  return <ListingForm farmId={farm ?? ''} />;
}
