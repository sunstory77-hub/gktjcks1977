import os
import time
import uuid
import logging
from pathlib import Path
from typing import Dict, Any
from PIL import Image, ImageDraw, ImageFont

from backend.config import settings
from backend.models import PosterRequest

logger = logging.getLogger(__name__)

class ImageGeneratorService:
    def __init__(self):
        # Ensure output directory exists
        Path(settings.STATIC_DIR).mkdir(parents=True, exist_ok=True)

        # Theme color mappings
        self.theme_colors = {
            "professional": ("#1a365d", "#ffffff"),
            "casual": ("#ff6b6b", "#ffffff"),
            "vibrant": ("#ff00ff", "#ffff00"),
            "elegant": ("#2c1810", "#d4af37"),
            "modern": ("#0a192f", "#64ffda"),
            "retro": ("#ff6347", "#ffd700"),
        }

        # Default colors
        self.default_colors = ("#4a5568", "#ffffff")

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
        """Generate a poster image (demo version with placeholder image)"""

        start_time = time.time()

        try:
            # Build the prompt (for logging/reference)
            prompt = self._build_prompt(request)
            logger.info(f"Generated prompt: {prompt}")

            # Create demo poster image
            filename = await self._create_demo_poster(request)

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

    async def _create_demo_poster(self, request: PosterRequest) -> str:
        """Create a demo poster using PIL"""
        try:
            # Get colors based on theme
            bg_color, text_color = self.theme_colors.get(
                request.theme or "",
                self.default_colors
            )

            # Create image
            width, height = settings.IMAGE_WIDTH, settings.IMAGE_HEIGHT
            image = Image.new('RGB', (width, height), color=bg_color)
            draw = ImageDraw.Draw(image)

            # Try to use a nice font, fallback to default
            try:
                title_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 80)
                desc_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 40)
                info_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
            except:
                title_font = ImageFont.load_default()
                desc_font = ImageFont.load_default()
                info_font = ImageFont.load_default()

            # Draw title (centered)
            title = request.title
            title_bbox = draw.textbbox((0, 0), title, font=title_font)
            title_width = title_bbox[2] - title_bbox[0]
            title_height = title_bbox[3] - title_bbox[1]
            title_x = (width - title_width) // 2
            title_y = height // 3

            # Add text shadow for better readability
            shadow_offset = 3
            draw.text((title_x + shadow_offset, title_y + shadow_offset),
                     title, fill="#00000088", font=title_font)
            draw.text((title_x, title_y), title, fill=text_color, font=title_font)

            # Draw description if provided
            if request.description:
                desc = request.description
                desc_bbox = draw.textbbox((0, 0), desc, font=desc_font)
                desc_width = desc_bbox[2] - desc_bbox[0]
                desc_x = (width - desc_width) // 2
                desc_y = title_y + title_height + 50

                draw.text((desc_x + 2, desc_y + 2), desc,
                         fill="#00000088", font=desc_font)
                draw.text((desc_x, desc_y), desc, fill=text_color, font=desc_font)

            # Draw decorative elements based on style
            if request.style == "minimalist":
                # Simple line decoration
                line_y = height - 100
                draw.line([(100, line_y), (width - 100, line_y)],
                         fill=text_color, width=3)
            elif request.style == "bold":
                # Bold border
                border_width = 20
                draw.rectangle(
                    [(border_width, border_width),
                     (width - border_width, height - border_width)],
                    outline=text_color, width=border_width
                )

            # Add info text at bottom
            info_text = f"Theme: {request.theme or 'default'} | Style: {request.style or 'default'}"
            info_bbox = draw.textbbox((0, 0), info_text, font=info_font)
            info_width = info_bbox[2] - info_bbox[0]
            info_x = (width - info_width) // 2
            info_y = height - 60
            draw.text((info_x, info_y), info_text, fill=text_color, font=info_font)

            # Add "DEMO" watermark
            demo_text = "DEMO POSTER"
            demo_bbox = draw.textbbox((0, 0), demo_text, font=info_font)
            demo_width = demo_bbox[2] - demo_bbox[0]
            demo_x = (width - demo_width) // 2
            demo_y = 30
            draw.text((demo_x, demo_y), demo_text,
                     fill="#ffffff44", font=info_font)

            # Save image
            filename = f"{uuid.uuid4()}.png"
            filepath = os.path.join(settings.STATIC_DIR, filename)
            image.save(filepath, 'PNG', quality=95)

            logger.info(f"Created demo poster: {filepath}")
            return filename

        except Exception as e:
            logger.error(f"Error creating demo poster: {str(e)}")
            raise ValueError(f"Failed to create demo poster: {str(e)}")

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
