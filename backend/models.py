from pydantic import BaseModel, Field, validator
from typing import Optional
from datetime import datetime

class PosterRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=100, description="Main title for the poster")
    description: Optional[str] = Field(None, max_length=500, description="Additional description or tagline")
    theme: Optional[str] = Field(None, description="Theme (e.g., professional, casual, vibrant)")
    style: Optional[str] = Field(None, description="Visual style (e.g., minimalist, bold, elegant)")
    additional_instructions: Optional[str] = Field(None, max_length=300, description="Any additional customization")

    @validator('title')
    def title_not_empty(cls, v):
        if not v.strip():
            raise ValueError('Title cannot be empty or whitespace only')
        return v.strip()

    @validator('description', 'additional_instructions')
    def strip_optional_fields(cls, v):
        return v.strip() if v else None

class PosterResponse(BaseModel):
    success: bool = True
    image_url: str
    generation_time: float
    prompt_used: str

class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    details: Optional[str] = None
