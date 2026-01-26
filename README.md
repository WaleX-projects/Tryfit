# 👕 Personal OS: AI Virtual Try-On Extension

An AI-powered Chrome extension that allows users to virtually "try on" clothes from eCommerce sites like Jumia using **Bria AI** and **Fashn.ai**. It includes a sleek, Glassmorphism dashboard to track your style history.



## ✨ Features
- **One-Click Try-On**: Hover over any clothing item on supported sites to see it on yourself.
- **Identity Preservation**: Uses advanced AI to ensure the user's face and body shape remain consistent.
- **Style Dashboard**: A dedicated web gallery to view, save, and download your favorite looks.
- **Cross-Platform Sync**: Sign in with Google to access your wardrobe on any device.

## 🛠️ Tech Stack
- **Frontend**: HTML5, Tailwind CSS (Apple Minimalist/Glassmorphism design).
- **Backend**: Python (FastAPI), Uvicorn.
- **AI Models**: Bria AI (Image Generation), Fashn.ai (Virtual Try-On SDK).
- **Database/Auth**: Firebase (Firestore & Google Auth).

## 🚀 Getting Started

### 1. Backend Setup
1. Navigate to `/backend`.
2. Create a `.env` file and add your API keys:
   ```env
   BRIA_API_KEY=your_key
   FASHN_API_KEY=your_key
