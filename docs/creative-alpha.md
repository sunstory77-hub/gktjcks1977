# Creative Alpha Product Brief

## Overview
Creative Alpha is an AI-driven creative director agent that automates the end-to-end advertising workflow. It performs market research, drafts marketing strategy, writes copy, and generates high-end visuals. The experience is designed as a chat-style workspace where users provide a product brief, review AI proposals, and generate finished assets.

## Core Capabilities
1. **Automated Market Research**
   - Runs Google Search-grounded research to surface real-time trends.
   - Suggests target personas, pain points, and value propositions per product.

2. **Strategy & Copywriting**
   - Uses the `gemini-2.5-flash` model to define brand tone and produce headlines, sub-copy, and CTA options.

3. **High-End Visual Generation**
   - Employs **Nano Banana Pro** (`gemini-3-pro-image-preview`) for ad-ready images.
   - Supports seven visual styles (e.g., Photorealistic, 3D, Anime, Minimalist).
   - Accepts reference product photos to preserve brand identity during generation.

4. **Composite & Export**
   - Provides clean image downloads and poster exports that overlay headline/copy with gradient treatments.
   - Offers quick links to Canva and 미리캔버스 for further editing.

## User Flow
1. **Brief Input**: Enter product name/description, select a visual style, and optionally upload a product photo.
2. **Strategy Proposal**: Click "프로젝트 시작" to receive research-backed strategy recommendations.
3. **Asset Creation**: Confirm strategy and trigger "에셋 생성" to generate images.
4. **Refinement & Save**:
   - Provide feedback via chat to iterate on visuals.
   - Save outputs as raw images or posters with copy overlays.
   - Jump to Canva or 미리캔버스 via shortcut buttons.
5. **Reset**: Use the Home icon to start a new project.

## Technical Stack
- **Frontend**: React, TypeScript, Tailwind CSS.
- **AI SDK**: `@google/genai` with `gemini-2.5-flash` (text/logic) and `gemini-3-pro-image-preview` (image generation).

## Implementation Notes
- Image generation requires a Google Cloud project with billing-enabled API keys. Users may be prompted to select an API key during the process.
- Plan for a prompt routing layer that merges market insights with brand tone before copy/image generation.
- Poster composition should allow dynamic headline/copy placement and gradient layers while keeping a clean export option.

## Next Steps
- Scaffold the React + Tailwind frontend with a chat-centric layout and dual-pane asset preview.
- Implement research and strategy pipelines that call the text model with grounding enabled.
- Add upload handling for reference product photos and pass extracted features to image generation prompts.
- Build export utilities for both raw assets and poster composites, along with Canva/미리캔버스 deep links.
