import os
import time
import uuid
import base64
import logging
from pathlib import Path
from typing import Dict, Any

from google import genai
from google.genai import types

from backend.config import settings
from backend.models import PosterRequest

logger = logging.getLogger(__name__)

class ImageGeneratorService:
    def __init__(self):
        # Initialize Google GenAI client
        self.client = genai.Client(api_key=settings.GOOGLE_API_KEY)
        self.model = settings.GEMINI_MODEL

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
            "- Suitable for both digital and print use",
            f"- Image dimensions: {settings.IMAGE_WIDTH}x{settings.IMAGE_HEIGHT}"
        ])

        if request.additional_instructions:
            prompt_parts.append(f"Additional Instructions: {request.additional_instructions}")

        return "\n".join(prompt_parts)

    async def generate_poster(self, request: PosterRequest) -> Dict[str, Any]:
        """Generate a poster image using NanoBanana/Gemini API"""

        start_time = time.time()

        try:
            # Build the prompt
            prompt = self._build_prompt(request)
            logger.info(f"Generated prompt: {prompt}")

            # Call Gemini API
            response = self.client.models.generate_content(
                model=self.model,
                contents=[prompt],
                config=types.GenerateContentConfig(
                    temperature=0.7,
                    top_p=0.9,
                    max_output_tokens=8192,
                )
            )

            # Extract image from response
            image_data = self._extract_image_from_response(response)

            # Save the image
            filename = f"{uuid.uuid4()}.png"
            filepath = os.path.join(settings.STATIC_DIR, filename)

            with open(filepath, 'wb') as f:
                f.write(image_data)

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

    def _extract_image_from_response(self, response) -> bytes:
        """Extract image bytes from Gemini API response"""

        try:
            # Check if response has parts with image data
            if hasattr(response, 'candidates') and response.candidates:
                candidate = response.candidates[0]
                if hasattr(candidate, 'content') and candidate.content.parts:
                    for part in candidate.content.parts:
                        # Check for inline_data (image)
                        if hasattr(part, 'inline_data'):
                            return part.inline_data.data
                        # Check for text that might contain base64
                        if hasattr(part, 'text') and part.text:
                            # Try to decode as base64
                            try:
                                return base64.b64decode(part.text)
                            except:
                                pass

            raise ValueError("No image data found in response")

        except Exception as e:
            logger.error(f"Error extracting image: {str(e)}")
            raise ValueError(f"Failed to extract image from response: {str(e)}")

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
