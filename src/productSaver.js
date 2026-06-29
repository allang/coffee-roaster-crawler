const { getSupabase } = require('./supabase');
const globalLogger = require('./logger');
const { downloadAndSaveImage } = require('./imageDownloader');
const { updateProductAvailability } = require('./availability');

function sanitizeNullStrings(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj === 'null' || obj === 'NULL') return null;
  if (Array.isArray(obj)) {
    return obj.map(sanitizeNullStrings);
  }
  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeNullStrings(value);
    }
    return result;
  }
  if (typeof obj === 'string' && (obj === 'null' || obj === 'NULL')) {
    return null;
  }
  return obj;
}

function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

function parsePriceCents(priceStr) {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return null;
  return Math.round(parsed * 100);
}

function parseWeightGrams(weightStr) {
  if (!weightStr) return null;
  const lower = weightStr.toLowerCase();
  
  const match = lower.match(/([\d.]+)\s*(g|kg|oz|lb|lbs|gram|grams|kilogram|kilograms|ounce|ounces|pound|pounds)/);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = match[2];

  if (unit.startsWith('kg') || unit.startsWith('kilo')) {
    return Math.round(value * 1000);
  } else if (unit.startsWith('oz') || unit.startsWith('ounce')) {
    return Math.round(value * 28.35);
  } else if (unit.startsWith('lb') || unit.startsWith('pound')) {
    return Math.round(value * 453.59);
  } else {
    return Math.round(value);
  }
}

async function saveProduct(entityId, productData, sourceUrl, log = null, options = {}) {
  const logger = log || globalLogger;
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const sanitizedData = sanitizeNullStrings(productData);
  
  if (!sanitizedData.name || typeof sanitizedData.name !== 'string') {
    logger.warn('ProductSaver', 'Product has no valid name, skipping', { sourceUrl });
    return null;
  }
  
  const slug = generateSlug(sanitizedData.name);

  const metadata = sanitizedData.attributes ? { ...sanitizedData.attributes } : {};
  if (sanitizedData.default_price) {
    metadata.default_price = sanitizedData.default_price;
  }
  if (sanitizedData.variant_prices && sanitizedData.variant_prices.length > 0) {
    metadata.variant_prices = sanitizedData.variant_prices;
  }

  const productRecord = {
    entity_id: entityId,
    slug: slug,
    name: sanitizedData.name,
    product_type: 'coffee',
    source_url: sourceUrl,
    is_active: true,
    first_seen_at: now,
    last_seen_at: now,
    metadata: metadata,
    description_html: sanitizedData.description_html || null,
    description_raw: sanitizedData.description_raw || null,
  };

  const { data: existingProduct, error: fetchError } = await supabase
    .from('products')
    .select('id')
    .eq('entity_id', entityId)
    .eq('slug', slug)
    .single();

  let productId;

  if (existingProduct) {
    const { error: updateError } = await supabase
      .from('products')
      .update({
        last_seen_at: now,
        source_url: sourceUrl,
        metadata: metadata,
        description_html: sanitizedData.description_html || null,
        description_raw: sanitizedData.description_raw || null,
      })
      .eq('id', existingProduct.id);

    if (updateError) {
      logger.error('ProductSaver', 'Failed to update product', { error: updateError.message });
      throw updateError;
    }
    productId = existingProduct.id;
    logger.info('ProductSaver', `Updated existing product: ${sanitizedData.name}`);
  } else {
    const { data: newProduct, error: insertError } = await supabase
      .from('products')
      .insert(productRecord)
      .select('id')
      .single();

    if (insertError) {
      logger.error('ProductSaver', 'Failed to insert product', { error: insertError.message });
      throw insertError;
    }
    productId = newProduct.id;
    logger.success('ProductSaver', `Created new product: ${sanitizedData.name}`);
  }

  const currency = sanitizedData.variant_price_currency || 'USD';
  if (sanitizedData.variant_prices && sanitizedData.variant_prices.length > 0) {
    await saveVariants(productId, sanitizedData.variant_prices, sanitizedData.default_price, currency, logger);
  } else if (sanitizedData.default_price) {
    await saveVariants(productId, [], sanitizedData.default_price, currency, logger);
  }

  if (sanitizedData.attributes) {
    await saveCoffeeFacts(productId, sanitizedData.attributes, logger);

    if (sanitizedData.attributes.product_image_url) {
      await downloadAndSaveImage(productId, sanitizedData.attributes.product_image_url, logger);
    }
  }

  if (options.availability) {
    await updateProductAvailability(productId, options.availability, now, logger);
  }

  return productId;
}

async function saveVariants(productId, variantPrices, defaultPrice, currency, logger) {
  const supabase = getSupabase();

  const { error: deleteError } = await supabase
    .from('product_variants')
    .delete()
    .eq('product_id', productId);

  if (deleteError) {
    logger.warn('ProductSaver', 'Failed to clear old variants', { error: deleteError.message });
  }

  const variants = [];

  if (variantPrices.length > 0) {
    for (const [weight, price] of variantPrices) {
      variants.push({
        product_id: productId,
        variant_name: weight,
        weight_g: parseWeightGrams(weight),
        price_cents: parsePriceCents(price),
        currency: currency,
        availability: 'in_stock',
      });
    }
  } else if (defaultPrice) {
    variants.push({
      product_id: productId,
      variant_name: 'default',
      weight_g: null,
      price_cents: parsePriceCents(defaultPrice),
      currency: currency,
      availability: 'in_stock',
    });
  }

  if (variants.length > 0) {
    const { error: insertError } = await supabase
      .from('product_variants')
      .insert(variants);

    if (insertError) {
      logger.warn('ProductSaver', 'Failed to save variants', { error: insertError.message });
    }
  }
}

async function saveCoffeeFacts(productId, attributes, logger) {
  const supabase = getSupabase();

  const { error: deleteError } = await supabase
    .from('coffee_facts')
    .delete()
    .eq('product_id', productId);

  if (deleteError) {
    logger.warn('ProductSaver', 'Failed to clear old coffee facts', { error: deleteError.message });
  }

  const flavorNotes = attributes.flavor_notes;
  let tastingNotesRaw = null;
  if (Array.isArray(flavorNotes)) {
    tastingNotesRaw = flavorNotes.join(', ');
  } else if (typeof flavorNotes === 'string') {
    tastingNotesRaw = flavorNotes;
  }

  const facts = {
    product_id: productId,
    process: attributes.varietal || null,
    variety: attributes.varietal || null,
    roast_level: attributes.roast_darkness || null,
    tasting_notes_raw: tastingNotesRaw,
  };

  const { error: insertError } = await supabase
    .from('coffee_facts')
    .insert(facts);

  if (insertError) {
    logger.warn('ProductSaver', 'Failed to save coffee facts', { error: insertError.message });
  }
}

module.exports = {
  saveProduct,
  generateSlug,
  parsePriceCents,
  parseWeightGrams,
};
