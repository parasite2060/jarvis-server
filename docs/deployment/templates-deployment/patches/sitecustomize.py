"""
Workaround for psycopg-binary returning bytes for version(),
which breaks SQLAlchemy's PG dialect version detection.

This file is mounted into the memu-server container's site-packages
and runs automatically on Python startup.
"""
import re


def _patch_sqlalchemy_pg_version():
    try:
        import sqlalchemy.dialects.postgresql.base as pgbase
    except ImportError:
        return

    _orig = pgbase.PGDialect._get_server_version_info

    def _patched(self, connection):
        v = connection.exec_driver_sql("select pg_catalog.version()").scalar()
        if isinstance(v, (bytes, bytearray)):
            v = v.decode("utf-8")
        m = re.match(
            r".*(?:PostgreSQL|EnterpriseDB) "
            r"(\d+)\.?(\d+)?(?:\.(\d+))?(?:\.\d+)?(?:devel|beta)?",
            v,
        )
        if not m:
            raise AssertionError(
                "Could not determine version from string: %s" % v
            )
        return tuple(int(x) for x in m.group(1, 2, 3) if x is not None)

    pgbase.PGDialect._get_server_version_info = _patched


_patch_sqlalchemy_pg_version()
