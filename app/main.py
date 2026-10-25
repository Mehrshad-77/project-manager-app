"""project-manager: one FastAPI app serving every project's API and the front end."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app import db
from qaem.backend.routes import router as qaem_router

# Registry shown in the front-end project selector. "id" is the English name used in URLs and code;
# "title" and "description" are the Farsi text shown to people. Set active=True once a project has its routes.
PROJECTS = [
    {"id": "qaem", "title": "قائم", "description": "ثبت و پایش سرویس‌های روزانهٔ کامیون‌ها", "active": True},
    {"id": "shahran", "title": "شهران", "description": "ثبت و پیگیری پرداخت حقوق کارگران", "active": False},
    {"id": "self", "title": "خودکفایی", "description": "ثبت و پیگیری پرداخت حقوق کارگران", "active": False},
]

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.open_pool()
    yield
    db.close_pool()


app = FastAPI(title="project-manager", lifespan=lifespan)
app.include_router(qaem_router)


@app.get("/api/projects")
def list_projects():
    return PROJECTS


@app.get("/api/health")
def health():
    with db.db() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


# Mounted last so it never shadows /api routes.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")