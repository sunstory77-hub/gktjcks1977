from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
import uvicorn
import logging
from datetime import datetime

from backend.models import PosterRequest, PosterResponse, ErrorResponse
from backend.services.image_generator import ImageGeneratorService
from backend.config import settings

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Poster Auto-Creation API",
    description="API for generating promotional posters using NanoBanana/Gemini",
    version="1.0.0"
)

# CORS middleware for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files directory
app.mount("/static", StaticFiles(directory="static"), name="static")

# Initialize image generator service
image_service = ImageGeneratorService()

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }

@app.post("/api/generate-poster", response_model=PosterResponse)
async def generate_poster(request: PosterRequest):
    try:
        logger.info(f"Received poster generation request: {request.title}")

        # Generate the poster
        result = await image_service.generate_poster(request)

        logger.info(f"Successfully generated poster: {result['image_url']}")
        return result

    except ValueError as e:
        logger.error(f"Validation error: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Failed to generate poster. Please try again."
        )

@app.get("/")
async def root():
    # Serve the frontend HTML
    return FileResponse("frontend/index.html")

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG
    )
