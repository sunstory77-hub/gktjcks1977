// API Configuration
const API_BASE_URL = window.location.origin;
const API_GENERATE_ENDPOINT = '/api/generate-poster';

// DOM Elements
const posterForm = document.getElementById('posterForm');
const generateBtn = document.getElementById('generateBtn');
const resultSection = document.getElementById('resultSection');
const loadingIndicator = document.getElementById('loadingIndicator');
const resultSuccess = document.getElementById('resultSuccess');
const resultError = document.getElementById('resultError');
const posterImage = document.getElementById('posterImage');
const generationTime = document.getElementById('generationTime');
const promptUsed = document.getElementById('promptUsed');
const errorMessage = document.getElementById('errorMessage');
const downloadBtn = document.getElementById('downloadBtn');
const generateAnotherBtn = document.getElementById('generateAnotherBtn');
const tryAgainBtn = document.getElementById('tryAgainBtn');

// Character counters
const titleInput = document.getElementById('title');
const descriptionInput = document.getElementById('description');
const instructionsInput = document.getElementById('additionalInstructions');
const titleCount = document.getElementById('titleCount');
const descriptionCount = document.getElementById('descriptionCount');
const instructionsCount = document.getElementById('instructionsCount');

// State
let currentImageUrl = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupCharacterCounters();
    setupFormSubmission();
    setupActionButtons();
});

// Character counter functionality
function setupCharacterCounters() {
    titleInput.addEventListener('input', () => {
        updateCharCount(titleInput, titleCount, 100);
    });

    descriptionInput.addEventListener('input', () => {
        updateCharCount(descriptionInput, descriptionCount, 500);
    });

    instructionsInput.addEventListener('input', () => {
        updateCharCount(instructionsInput, instructionsCount, 300);
    });
}

function updateCharCount(input, countElement, max) {
    const current = input.value.length;
    countElement.textContent = `${current}/${max}`;

    if (current > max * 0.9) {
        countElement.style.color = '#ea4335';
    } else {
        countElement.style.color = '#5f6368';
    }
}

// Form submission
function setupFormSubmission() {
    posterForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await generatePoster();
    });
}

async function generatePoster() {
    // Collect form data
    const formData = {
        title: titleInput.value.trim(),
        description: descriptionInput.value.trim() || null,
        theme: document.getElementById('theme').value || null,
        style: document.getElementById('style').value || null,
        additional_instructions: instructionsInput.value.trim() || null
    };

    // Validate
    if (!formData.title) {
        showError('포스터 제목을 입력해주세요');
        return;
    }

    // Show loading state
    showLoading();

    try {
        const response = await fetch(`${API_BASE_URL}${API_GENERATE_ENDPOINT}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.detail || '포스터 생성에 실패했습니다');
        }

        // Show success
        showSuccess(data);

    } catch (error) {
        console.error('Error generating poster:', error);
        showError(error.message || '예기치 않은 오류가 발생했습니다. 다시 시도해주세요.');
    }
}

// UI State Functions
function showLoading() {
    resultSection.style.display = 'flex';
    loadingIndicator.style.display = 'block';
    resultSuccess.style.display = 'none';
    resultError.style.display = 'none';
    generateBtn.disabled = true;
    generateBtn.textContent = '생성 중...';
}

function showSuccess(data) {
    currentImageUrl = data.image_url;

    // Update image
    posterImage.src = `${API_BASE_URL}${data.image_url}`;
    posterImage.alt = '생성된 포스터';

    // Update info
    generationTime.textContent = data.generation_time;
    promptUsed.textContent = data.prompt_used;

    // Show success view
    loadingIndicator.style.display = 'none';
    resultSuccess.style.display = 'block';
    resultError.style.display = 'none';

    // Reset button
    generateBtn.disabled = false;
    generateBtn.textContent = '포스터 생성';
}

function showError(message) {
    errorMessage.textContent = message;

    resultSection.style.display = 'flex';
    loadingIndicator.style.display = 'none';
    resultSuccess.style.display = 'none';
    resultError.style.display = 'block';

    generateBtn.disabled = false;
    generateBtn.textContent = '포스터 생성';
}

function resetView() {
    resultSection.style.display = 'none';
    loadingIndicator.style.display = 'none';
    resultSuccess.style.display = 'none';
    resultError.style.display = 'none';
    currentImageUrl = null;
}

// Action Buttons
function setupActionButtons() {
    downloadBtn.addEventListener('click', downloadPoster);
    generateAnotherBtn.addEventListener('click', resetForNewGeneration);
    tryAgainBtn.addEventListener('click', () => {
        resetView();
    });
}

function downloadPoster() {
    if (!currentImageUrl) return;

    const link = document.createElement('a');
    link.href = `${API_BASE_URL}${currentImageUrl}`;
    link.download = `poster-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function resetForNewGeneration() {
    posterForm.reset();
    updateCharCount(titleInput, titleCount, 100);
    updateCharCount(descriptionInput, descriptionCount, 500);
    updateCharCount(instructionsInput, instructionsCount, 300);
    resetView();
}
