/**
 * Signature Service
 *
 * Deterministic signature generation for Products and Variants.
 * Product Signature = brand + base_model (excludes storage/color).
 * Variant Signature = storage + color (scoped per product).
 */

// ── Canonical brand names (ONLY these are excluded from model tokens) ──
const CANONICAL_BRANDS = new Set([
    'apple',
    'samsung',
    'xiaomi',
    'sony',
    'google',
    'dell',
    'hp',
    'lenovo',
    'asus',
    'acer',
    'msi',
    'oppo',
    'realme',
    'vivo',
    'huawei',
    'nokia',
    'lg',
    'oneplus',
    'nothing',
    'logitech',
    'razer',
    'corsair',
    'steelseries',
    'keychron',
    'jbl',
    'bose',
    'anker',
    'soundcore',
]);

// ── Brand aliases → canonical brand ────────────────────
// Alias tokens (e.g. "iphone") are mapped to a brand but NOT removed from model tokens.
const BRAND_ALIASES: Record<string, string> = {
    // Apple
    'apple': 'apple',
    'iphone': 'apple',
    'ipad': 'apple',
    'macbook': 'apple',
    'airpods': 'apple',
    'imac': 'apple',

    // Samsung
    'samsung': 'samsung',
    'galaxy': 'samsung',

    // Xiaomi
    'xiaomi': 'xiaomi',
    'redmi': 'xiaomi',
    'poco': 'xiaomi',
    'mi': 'xiaomi',

    // Google
    'google': 'google',
    'pixel': 'google',

    // OnePlus / Nothing
    'oneplus': 'oneplus',
    'nothing': 'nothing',

    // OPPO / Realme / Vivo
    'oppo': 'oppo',
    'realme': 'realme',
    'vivo': 'vivo',

    // Huawei
    'huawei': 'huawei',

    // Sony
    'sony': 'sony',
    'xperia': 'sony',
    'playstation': 'sony',

    // LG / Nokia
    'lg': 'lg',
    'nokia': 'nokia',

    // Laptop brands
    'dell': 'dell',
    'inspiron': 'dell',
    'xps': 'dell',
    'hp': 'hp',
    'pavilion': 'hp',
    'elitebook': 'hp',
    'lenovo': 'lenovo',
    'thinkpad': 'lenovo',
    'ideapad': 'lenovo',
    'asus': 'asus',
    'zenbook': 'asus',
    'rog': 'asus',
    'vivobook': 'asus',
    'acer': 'acer',
    'nitro': 'acer',
    'aspire': 'acer',
    'msi': 'msi',

    // Peripherals
    'logitech': 'logitech',
    'razer': 'razer',
    'corsair': 'corsair',
    'steelseries': 'steelseries',
    'keychron': 'keychron',

    // Audio
    'jbl': 'jbl',
    'bose': 'bose',
    'anker': 'anker',
    'soundcore': 'soundcore',
};

// ── Color dictionary ───────────────────────────────────
const KNOWN_COLORS = new Set([
    'silver', 'black', 'white', 'gold', 'blue',
    'purple', 'pink', 'green', 'red', 'yellow',
    'gray', 'grey', 'titanium', 'graphite', 'midnight',
    'starlight', 'coral', 'cream', 'lavender', 'mint',
]);

// ── Regex patterns ─────────────────────────────────────
const STORAGE_REGEX = /(\d+)\s?(gb|tb)/i;

// ── Model-specific tokens that must NOT be stripped ────
const MODEL_TOKENS = new Set([
    'pro', 'max', 'plus', 'ultra', 'mini', 'lite',
    'note', 'air', 'se', 'neo', 'gt', 'fe', 'fold', 'flip',
]);

// ── Stop words to strip from signatures ────────────────
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'with', 'new', 'original',
    'official', 'store', 'shop', 'genuine', 'authentic', 'sale',
    'flash', 'hot', 'best', 'seller', 'chinh', 'hang',
    'free', 'ship', 'shipping', 'cod',
]);

export interface SignatureResult {
    brand: string | null;
    model: string | null;
    productSignature: string;
    variantSignature: string;
    storage: string | null;
    color: string | null;
    normalizedName: string;
}

/**
 * Normalize a raw title into clean lowercase tokens.
 */
function normalizeTitle(title: string): string {
    return title
        .toLowerCase()
        // Support Vietnamese characters and basic alphanumeric
        .replace(/[^a-z0-9\sàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extract storage token from a title string.
 * Returns e.g. "256gb" or null.
 */
function extractStorage(title: string): string | null {
    const match = title.match(STORAGE_REGEX);
    if (!match) return null;
    return `${match[1]}${match[2].toLowerCase()}`;
}

/**
 * Extract the first known color from title tokens.
 */
function extractColor(normalizedTokens: string[]): string | null {
    for (const token of normalizedTokens) {
        if (KNOWN_COLORS.has(token)) return token;
    }
    return null;
}

/**
 * Detect brand from the first recognizable token.
 * Returns the CANONICAL brand name (e.g. "apple"), not the alias.
 */
function detectBrand(tokens: string[]): string | null {
    for (const token of tokens) {
        if (BRAND_ALIASES[token]) {
            return BRAND_ALIASES[token];
        }
    }
    return null;
}

/**
 * Generate deterministic Product Signature and Variant Signature.
 *
 * Product Signature: brand + model tokens (no storage, no color).
 *   - Only CANONICAL brand names are excluded from model tokens.
 *   - Alias tokens like "iphone", "galaxy", "pixel" are KEPT in model tokens.
 *
 * Variant Signature: storage_color (scoped per product).
 */
export function generateSignatures(title: string): SignatureResult {
    const normalized = normalizeTitle(title);
    const tokens = normalized.split(' ').filter(Boolean);

    // 1. Extract variant attributes
    const storage = extractStorage(normalized);
    const color = extractColor(tokens);

    // 2. Detect brand (canonical form)
    const brand = detectBrand(tokens);

    // 3. Build the set of tokens to exclude from the model
    //    ONLY exclude: canonical brand names, storage digits, color, stop words
    const storageTokens = storage
        ? [storage, ...storage.replace(/(\d+)(gb|tb)/, '$1 $2').split(' ')]
        : [];

    const excludeSet = new Set<string>([
        ...CANONICAL_BRANDS,     // Only canonical names, NOT aliases like "iphone"
        ...storageTokens,
        ...(color ? [color] : []),
    ]);

    // 4. Filter tokens to build model
    const modelTokens = tokens.filter(token =>
        !excludeSet.has(token) &&
        !STOP_WORDS.has(token) &&
        token.length > 0 &&
        (MODEL_TOKENS.has(token) || /[a-z]/.test(token) || /^\d+$/.test(token))
    );

    // 4.5 Detect if this is an accessory (independent of query)
    const accessoryKeywords = [
        'op', 'case', 'cover', 'charger', 'sac', 'cable', 'cap', 'adapter', 'screen protector',
        'tempered', 'glass', 'cuong luc', 'strap', 'band', 'holder', 'gia do', 'tripod',
        'bag', 'pouch', 'skin', 'sticker', 'bao da', 'tai nghe', 'mieng dan',
        'phu kien', 'box', 'hop', 'khay sim', 'chong nhin trom'
    ];
    const isAccessory = accessoryKeywords.some(ak => {
        if (ak.includes(' ')) return normalized.includes(ak);
        return tokens.includes(ak);
    });

    // 5. Build product signature: brand + model tokens
    const sigParts: string[] = [];
    if (isAccessory) sigParts.push('acc'); // Prefix for accessories
    if (brand) sigParts.push(brand);
    sigParts.push(...modelTokens);
    const productSignature = sigParts.join('_') || 'unknown';

    // 6. Build variant signature: storage_color
    const variantParts: string[] = [];
    if (storage) variantParts.push(storage);
    if (color) variantParts.push(color);
    const variantSignature = variantParts.join('_') || 'default';

    // 7. Build display-friendly model name
    const model = modelTokens.join(' ') || null;

    return {
        brand,
        model,
        productSignature,
        variantSignature,
        storage: storage || null,
        color: color || null,
        normalizedName: normalized,
    };
}
