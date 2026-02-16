# 👕 Personal OS: AI Virtual Try-On Extension

An AI-powered Chrome extension that allows users to virtually "try on" clothes from eCommerce sites like Jumia using **Gemini AI **. It includes a sleek dashboard to track your style history.

![demo image](screenshot.png)



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
## 1. Clone repo 
 ```env
   git clone https://github.com/WaleX-projects/Tryfit.git
```
### 2. Backend Setup
1. Navigate to `/backend`.
2. Create a `.env` file and add your API keys:
   ```env
   api_key = ...
   ```
3. ```env
   python manage.py makemigrations

   python manage.py migrate
   ```
4. RUN the backend server
```env
   python manage.py runserver
   ```

   
## 3. Frontend setup and deployment
1. deploy to google chrome extenstion 