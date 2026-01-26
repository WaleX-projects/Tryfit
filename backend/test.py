import BriaAIService
bria_ai = BriaAIService(api_key="57f68b3b3b244ab58363b8363fcba8c7")
result_url = await bria_ai.generate_fit(garment_base64, human_base64)
print("Generated Try-On Image URL:", result_url)
