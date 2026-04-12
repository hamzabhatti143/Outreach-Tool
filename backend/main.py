import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from db.database import init_db
from utils.smtp_check import check_smtp_connection
from routers import auth, campaigns, sources, leads, outreach, bulk, sent, tracking, settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing database...")
    await init_db()
    logger.info("Database initialized.")

    logger.info("Checking SMTP connection...")
    smtp_status = await check_smtp_connection()
    if smtp_status["ok"]:
        logger.info("SMTP connection OK.")
    else:
        logger.warning(f"SMTP check failed: {smtp_status['error']}")

    yield
    # Shutdown
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

# Mount routers
app.include_router(auth.router)
app.include_router(campaigns.router)
app.include_router(sources.router)
app.include_router(leads.router)
app.include_router(outreach.router)
app.include_router(bulk.router)
app.include_router(sent.router)
app.include_router(tracking.router)
app.include_router(settings.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
