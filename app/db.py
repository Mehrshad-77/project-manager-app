"""Database connection pool shared by all projects."""
import os

from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

load_dotenv()

_pool: ConnectionPool | None = None


def open_pool() -> None:
    global _pool
    _pool = ConnectionPool(
        os.environ["DATABASE_URL"],
        min_size=1,
        max_size=5,
        kwargs={"row_factory": dict_row},
        open=True,
    )


def close_pool() -> None:
    if _pool is not None:
        _pool.close()


def db():
    """Use as `with db() as conn:` -- commits on success, rolls back on any exception."""
    return _pool.connection()
