import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db.database import init_db
from routers import auth, campaigns, sources, leads, outreach, bulk, sent, tracking, settings, replies
from routers import gmail

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database...")
    await init_db()
    logger.info("Database initialized.")
    yield
    logger.info("Shutting down.")


app = FastAPI(
    title="Outreach Tool API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://hamzabhatti-outreach-tool-82fb335.hf.space",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(gmail.router)
app.include_router(campaigns.router)
app.include_router(sources.router)
app.include_router(leads.router)
app.include_router(outreach.router)
app.include_router(bulk.router)
app.include_router(sent.router)
app.include_router(tracking.router)
app.include_router(settings.router)
app.include_router(replies.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
