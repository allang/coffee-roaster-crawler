const OpenAI = require("openai");
const logger = require("./logger");

const MODEL = "gpt-4o-mini";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildPrompt(content) {
  return `You are CoffeeWebsiteExtractorGPT. Analyze the included product page from a coffee website and return data in perfectly formatted JSON. Here are the rules:

1. If you detect that this is NOT a product page, you should return only the following JSON: { "is_product": false }

2. If you detect that this is a NOT product page for a coffee OR this is not a product page (e.g., equipment or merchandise), you should return only the following JSON: { "is_coffee_page": false }

3. If this is a product page for a coffee (e.g., a coffee bag, cold brew, instant coffee, etc..), you should return  perfectly formatted JSON using the following example:

    { 
      "is_coffee_page": true, 
      "product": {
        "name": "Name of the coffee",
        "default_price":  "$20.00",
        "variant_prices": [["250g", "$20.00"], ["100g", "$12.00"] , ["1lb", "$60.00"]],
        "attributes": {
            "origin_type": "Single Origin",
            "country_of_origin": "Ethiopia",
            "origin_region": "Yirgacheffe",
            "is_decaf": false,
            "varietal": "Wush Wush",
            "flavor_notes": ["Blueberry", "Vanilla", "Cotton Candy"],
            "grind_size_offered": ["whole bean", "espresso"],
            "altitude": "1500masl",
            "brew_as": ["Espresso", "Filter"],
            "roast_darkness": "light",
            "producer": "Banko Gotti",
            "description": "The general description of the coffee as provided by the roaster",
            "short_description": "A summarized description of the coffee",
            "nano_description": "A very small description of the coffee",
            "harvest_date": "12/2025"
            "product_image_url": "https://example.com/image.jpg"
        }
      }  
    }


Rules:
- All JSON values for "product" should be strings.
- When there are no variant prices, return an empty array
- The origin_type can be Single Origin or Blend.
- The "brew_as" field should default to "filter" unless the product page specifies the brew method or type. All types are: Espresso, Filter, and Cold Brew.
- Some values will not be found on the page. Mark them as null instead of using a blank string.
- For "short_description", summarize the roaster's description. Limit the description to 400 chars.
- For "nano_description", limit the description to 100 chars.
- Some pages will not be in english. Translate all names and attributes to english. 
- YOU MAY NOT guess about the attributes. 
- Your output must be pure JSON because it will be parsed by a computer.
- The image being saved should be of the product. Prefer the image with the coffee name in the image asset path that is the largest image available. It must be the product image, not the roaster logo or other images.

The page content is:
"${content}"

Extracted JSON data:`;
}

async function classifyPage(pageContent, url) {
  const prompt = buildPrompt(pageContent);

  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 2000,
    });

    const text = response.choices[0]?.message?.content?.trim();

    if (!text) {
      return { error: "Empty response from GPT" };
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { error: "No JSON found in response", rawResponse: text };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return { success: true, data: parsed };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { error: "Failed to parse JSON response", details: error.message };
    }
    logger.error("GPT", "Classification failed", { url, error: error.message });
    return { error: error.message };
  }
}

module.exports = {
  classifyPage,
  MODEL,
};
