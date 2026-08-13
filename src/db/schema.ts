/**
 * Which schema Prisma should address.
 *
 * Kraal shares a Supabase database with an unrelated application living in
 * `public`. Getting this wrong does not fail loudly — it points a working
 * application at the wrong half of a shared database.
 *
 * Two mechanisms are needed and they are NOT interchangeable:
 *
 *   - The `kraal_app` role carries a server-side `search_path`, which resolves
 *     unqualified names in RAW SQL (src/db/spatial.ts). It survives the
 *     transaction pooler because it is attached to the role, not the session.
 *
 *   - This value, which is what Prisma's generated model queries use. Prisma
 *     schema-qualifies them explicitly and defaults to `public`, so no
 *     search_path can influence them. Without it, `prisma.zone.findMany()`
 *     asks for `public.zones` and fails with P2021 even though a raw
 *     `SELECT * FROM zones` on the very same connection succeeds.
 *
 * It lives in its own module, apart from the client, so that reading it does
 * not construct a database connection. That is not tidiness: the client is
 * instantiated at import time and throws without DATABASE_URL, so a test of
 * this function used to require a database URL to test a string.
 */
export function resolveSchema(connectionString: string): string | undefined {
  const explicit = process.env.DB_SCHEMA?.trim();
  if (explicit) return explicit;
  const fromUrl = /[?&]schema=([^&]+)/.exec(connectionString)?.[1];
  return fromUrl ? decodeURIComponent(fromUrl) : undefined;
}
