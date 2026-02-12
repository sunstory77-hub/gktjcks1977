import os
import time
import uuid
import logging
import httpx
from pathlib import Path
from typing import Dict, Any

from openai import OpenAI

from backend.config import settings
from backend.models import PosterRequest

logger = logging.getLogger(__name__)

class ImageGeneratorService:
    def __init__(self):
        # Initialize OpenAI client
        self.client = OpenAI(api_key=settings.OPENAI_API_KEY)

        # Ensure output directory exists
        Path(settings.STATIC_DIR).mkdir(parents=True, exist_ok=True)

    def _build_prompt(self, request: PosterRequest) -> str:
        """Build the prompt for image generation from user input"""

        prompt_parts = [
            f"Create a professional promotional poster with the following specifications:",
            f"Main Title: {request.title}"
        ]

        if request.description:
            prompt_parts.append(f"Description/Tagline: {request.description}")

        if request.theme:
            prompt_parts.append(f"Theme: {request.theme}")

        if request.style:
            prompt_parts.append(f"Visual Style: {request.style}")

        # Add base requirements
        prompt_parts.extend([
            "Requirements:",
            "- High quality, eye-catching design",
            "- Clear, readable text that is prominently displayed",
            "- Professional composition and color scheme",
            "- Suitable for both digital and print use"
        ])

        if request.additional_instructions:
            prompt_parts.append(f"Additional Instructions: {request.additional_instructions}")

        return "\n".join(prompt_parts)

    async def generate_poster(self, request: PosterRequest) -> Dict[str, Any]:
        """Generate a poster image using OpenAI DALL-E API"""

        start_time = time.time()

        try:
            # Build the prompt
            prompt = self._build_prompt(request)
            logger.info(f"Generated prompt: {prompt}")

            # Call DALL-E API
            response = self.client.images.generate(
                model="dall-e-3",  # or "dall-e-2" for faster/cheaper generation
                prompt=prompt,
                size="1024x1024",  # Options: "1024x1024", "1792x1024", "1024x1792"
                quality="standard",  # Options: "standard", "hd"
                n=1,
            )

            # Get the image URL
            image_url = response.data[0].url
            logger.info(f"Generated image URL: {image_url}")

            # Download and save the image
            filename = await self._download_image(image_url)

            generation_time = time.time() - start_time

            return {
                "success": True,
                "image_url": f"/static/generated/{filename}",
                "generation_time": round(generation_time, 2),
                "prompt_used": prompt
            }

        except Exception as e:
            logger.error(f"Error generating image: {str(e)}")
            raise ValueError(f"Image generation failed: {str(e)}")

    async def _download_image(self, url: str) -> str:
        """Download image from URL and save locally"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url)
                response.raise_for_status()

                # Generate unique filename
                filename = f"{uuid.uuid4()}.png"
                filepath = os.path.join(settings.STATIC_DIR, filename)

                # Save the image
                with open(filepath, 'wb') as f:
                    f.write(response.content)

                logger.info(f"Saved image to: {filepath}")
                return filename

        except Exception as e:
            logger.error(f"Error downloading image: {str(e)}")
            raise ValueError(f"Failed to download image: {str(e)}")

    def cleanup_old_images(self):
        """Remove old generated images to save space"""
        try:
            files = sorted(
                Path(settings.STATIC_DIR).glob("*.png"),
                key=os.path.getmtime,
                reverse=True
            )

            # Keep only MAX_STORED_IMAGES most recent files
            for old_file in files[settings.MAX_STORED_IMAGES:]:
                old_file.unlink()
                logger.info(f"Removed old image: {old_file.name}")

        except Exception as e:
            logger.error(f"Error cleaning up old images: {str(e)}")
