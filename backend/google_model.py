import os
import base64
from google import genai
from google.genai import types

class GeminiService:
    def __init__(self, api_key: str):
        # Initialize the Google GenAI Client
        self.client = genai.Client(api_key=api_key)
        # Use the Nano Banana (Gemini 3 Flash Image) for best clothing results
        self.model_id = "gemini-3-flash-preview" 

    async def generate_fit(self, garment_base64: str, human_base64: str):
        # 1. Prepare the parts (Text + 2 Images)
        # We tell the model exactly what each image is
        prompt = (
            "You are a professional fashion editor. I have provided two images: "
            "1. A photo of a man. 2. A photo of a blazer. "
            "Generate a new photorealistic image of the EXACT same man from image 1 "
            "wearing the EXACT blazer from image 2. "
            "Keep his face, hair, and body shape identical. Ensure a masculine fit."
        )

        # Convert base64 strings to bytes
        human_bytes = base64.b64decode(human_base64.split(",")[-1])
        garment_bytes = base64.b64decode(garment_base64.split(",")[-1])

        contents = [
            prompt,
            types.Part.from_bytes(data=human_bytes, mime_type="image/jpeg"),
            types.Part.from_bytes(data=garment_bytes, mime_type="image/jpeg")
        ]

        try:
            # 2. Call the generate_content method
            # config helps ensure we get an image back as part of the modalities
            response = self.client.models.generate_content(
                model=self.model_id,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE"]
                )
            )

            # 3. Extract the generated image
            # Gemini returns parts; we look for the one containing image data
            for part in response.candidates[0].content.parts:
                if part.inline_data:
                    # Return as a base64 string for your frontend
                    return f"data:{part.inline_data.mime_type};base64,{base64.b64encode(part.inline_data.data).decode('utf-8')}"

            raise Exception("Gemini did not return an image.")

        except Exception as e:
            print(f"Gemini API Error: {e}")
            raise e