#!/usr/bin/env python3
import json
import sys


TENANTS = {
    "tenant-a": {
        "members": {"alice"},
        "secret": "TENANT_A_PUBLIC_FIXTURE",
    },
    "tenant-b": {
        "members": {"bob"},
        "secret": "BEALE_VULN_TENANT_B_SECRET",
    },
}

KNOWN_USERS = {member for tenant in TENANTS.values() for member in tenant["members"]}


def export_tenant(requesting_user: str, tenant_id: str) -> dict[str, str]:
    if requesting_user not in KNOWN_USERS:
        raise PermissionError("unknown user")
    tenant = TENANTS[tenant_id]
    # Intentional vulnerability: authentication is checked, but tenant membership is not.
    return {"requested_by": requesting_user, "tenant_id": tenant_id, "secret": tenant["secret"]}


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: tenant_export.py <user> <tenant_id>", file=sys.stderr)
        return 2
    try:
        print(json.dumps(export_tenant(sys.argv[1], sys.argv[2]), sort_keys=True))
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
