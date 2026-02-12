import re
from typing import Optional

def validate_api_key(api_key: str) -> bool:
    """Validate Google API key format"""
    if not api_key or len(api_key) < 20:
        return False
    return True

def sanitize_text(text: Optional[str]) -> Optional[str]:
    """Sanitize user input text"""
    if not text:
        return None

    # Remove potentially harmful characters
    # Keep alphanumeric, spaces, and common punctuation
    sanitized = re.sub(r'[^\w\s\-.,!?;:()\'"]+', '', text)
    return sanitized.strip()
