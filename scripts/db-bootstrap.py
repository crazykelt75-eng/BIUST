#!/usr/bin/env python3
"""
Make the database roles match the connection strings.

Five deploys have now failed on credentials that disagreed with the database:
a role whose password was never set, a role whose password was set to something
else, a username missing its project ref. Each cost a round trip through a human
editing a secret in a browser.

This inverts the relationship. DATABASE_URL and DIRECT_URL become the single
source of truth, and the database is altered to agree with them. Two properties
follow:

  * No password appears in the repository. Both are read out of the connection
    strings, which live in GitHub secrets.
  * Running it twice is the same as running it once. Setting a password to the
    value it already holds is a no-op.

It runs through Supabase's Management API rather than psql, deliberately: the
whole problem is that the database is refusing the credentials, so anything
needing those credentials to connect cannot be the thing that fixes them.

Requires SUPABASE_ACCESS_TOKEN. Without it this exits 0 and does nothing, so
the deploy works unchanged on an account that has its credentials in order.

Note the trust boundary this creates: whoever can edit the connection-string
secrets can set these roles' passwords. That is not a new power — anyone who
can edit repository secrets can already run arbitrary code with them — but it
is now an explicit one. Remove SUPABASE_ACCESS_TOKEN when the credentials are
settled and this step goes back to being a no-op.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from urllib.parse import unquote, urlsplit

API = "https://api.supabase.com/v1/projects/{ref}/database/query"

# api.supabase.com sits behind Cloudflare, which rejects urllib's default
# "Python-urllib/3.x" with a 403 and error code 1010 before the request ever
# reaches Supabase. An API client is expected to say what it is; this names the
# tool honestly so the rejection is not mistaken for an auth failure.
USER_AGENT = "kraal-deploy/1.0 (+https://github.com/crazykelt75-eng/BIUST)"

# Roles Supabase manages itself. The Management API runs SQL as `postgres`,
# which on Supabase is NOT a superuser, so it cannot alter these — not even
# itself. Their passwords come from the dashboard only.
RESERVED_ROLES = {
    "postgres",
    "supabase_admin",
    "supabase_auth_admin",
    "supabase_storage_admin",
    "authenticator",
    "anon",
    "authenticated",
    "service_role",
}


def parse(name):
    """Pull the role, password and project ref out of a connection string."""
    raw = os.environ.get(name, "")
    if not raw:
        sys.exit(f"✗ {name} is not set")
    parts = urlsplit(raw)
    if not parts.username or parts.password is None:
        sys.exit(f"✗ {name} has no username:password — cannot tell which role to set")

    # Supabase's poolers are multi-tenant and route on the username, so it
    # carries the project ref: postgres.<ref>, kraal_app.<ref>. That suffix is
    # also the only place the ref appears, which is why it is read from here.
    user = unquote(parts.username)
    role, _, ref = user.partition(".")
    if not ref:
        sys.exit(
            f"✗ {name}'s username is '{user}', with no project ref.\n"
            f"  Pooler usernames are tenant-qualified: {user}.<project-ref>"
        )
    return role, unquote(parts.password), ref


def ident(name):
    return '"' + name.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def execute(ref, token, query, label, optional=False):
    request = urllib.request.Request(
        API.format(ref=ref),
        data=json.dumps({"query": query}).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response.read()
    except urllib.error.HTTPError as error:
        body = error.read().decode(errors="replace")[:500]
        # Never echo the query — it contains a password.

        # Supabase's `postgres` is not a superuser and cannot alter privileged
        # roles, including itself. Its password is settable only from the
        # dashboard, by design. That is not necessarily a problem: the password
        # already in the secret may well be correct, and the preflight is what
        # actually knows. So say what happened and carry on rather than
        # failing a deploy that might have been fine.
        if optional and "permission denied to alter role" in body:
            print(
                f"  — {label} skipped: Supabase does not permit it.\n"
                f"    'postgres' is a privileged role; its password is settable only at\n"
                f"    Supabase dashboard → Settings → Database → Reset database password.\n"
                f"    Continuing — the preflight will say whether the current one works.",
                flush=True,
            )
            return

        hint = ""
        if error.code == 401:
            hint = "\n  The access token was rejected. Check it has not been revoked."
        elif error.code == 403 and "1010" in body:
            hint = (
                "\n  This is Cloudflare in front of the API rejecting the client, "
                "not Supabase\n  rejecting the token — check the User-Agent header."
            )
        elif error.code == 404:
            hint = f"\n  No project '{ref}' on this token's account."
        sys.exit(f"✗ {label} failed: HTTP {error.code}\n  {body}{hint}")
    except urllib.error.URLError as error:
        sys.exit(f"✗ {label} failed: cannot reach the Supabase API — {error.reason}")
    print(f"  ✓ {label}", flush=True)


def main():
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        print("Role bootstrap: skipped (no SUPABASE_ACCESS_TOKEN)", flush=True)
        return

    migration_role, migration_password, ref = parse("DIRECT_URL")
    runtime_role, runtime_password, runtime_ref = parse("DATABASE_URL")

    if runtime_ref != ref:
        sys.exit(
            f"✗ The two connection strings name different projects: "
            f"{ref} and {runtime_ref}. Refusing to guess which one is right."
        )

    print(f"Role bootstrap: project {ref}", flush=True)

    wanted = {migration_role: migration_password, runtime_role: runtime_password}
    if len(wanted) != len({migration_role, runtime_role}):
        sys.exit("✗ internal error building the role list")
    if migration_role == runtime_role and migration_password != runtime_password:
        sys.exit(
            f"✗ Both connection strings use the role '{migration_role}' but with "
            f"different passwords. One of the two secrets is stale."
        )

    for role, password in wanted.items():
        execute(
            ref,
            token,
            f"ALTER ROLE {ident(role)} WITH PASSWORD {literal(password)}",
            f"password set for {role}",
            # Supabase reserves its own roles. Ours we can set outright; a
            # reserved one we can only ask about and report on.
            optional=role in RESERVED_ROLES,
        )

    # The silent failure this deployment is most exposed to: the runtime role
    # connecting with a default search_path, so unqualified queries resolve
    # against public — where an unrelated application lives — and nothing
    # errors. It must be set at role level; per-connection settings do not
    # survive the transaction pooler.
    if runtime_role != "postgres":
        execute(
            ref,
            token,
            f"ALTER ROLE {ident(runtime_role)} SET search_path = kraal, extensions",
            f"search_path pinned to kraal for {runtime_role}",
        )


if __name__ == "__main__":
    main()
