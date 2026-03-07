import { Listing } from '../types/listing';

export interface RankedListing extends Listing {
    relevanceScore: number;
    matchRate: number;
}

export interface PipelineConfig {
    tokenMatchThreshold: number;
    priceMedianMinMultiplier: number;
    priceMedianMaxMultiplier: number;
    scoreThreshold: number;
    maxResults: number;
    stopWords: string[];
    accessoryKeywords: string[];
}

const DEFAULT_CONFIG: PipelineConfig = {
    tokenMatchThreshold: 0.45,
    priceMedianMinMultiplier: 0.3,
    priceMedianMaxMultiplier: 5.0,
    scoreThreshold: 2,
    maxResults: 10,
    stopWords: [
        'the', 'a', 'an', 'and', 'or', 'for', 'with', 'new', 'official', 'store',
        'shop', 'auth', 'genuine', 'chinhhang', 'gia', 'tot', 'flash', 'sale',
        'cho', 'của', 'và', 'có', 'là', 'ở', 'tại', 'với', 'giá', 'tốt', 'mới',
        'chính', 'hãng', 'uy', 'tín', 'rẻ', 'nhất', 'siêu'
    ],
    accessoryKeywords: [
        'case', 'cover', 'charger', 'cable', 'adapter', 'dock', 'screen protector',
        'tempered', 'glass', 'strap', 'band', 'holder', 'tripod', 'mount',
        'bag', 'pouch', 'skin', 'sticker', 'bao da', 'op lung', 'tai nghe',
        'sac', 'cuong luc', 'mieng dan', 'cục sạc', 'dây sạc', 'ốp lưng',
        'kính cường lực', 'dán màn hình', 'tai nghe', 'pin dự phòng', 'sạc dự phòng',
        'ốp', 'vỏ', 'phụ kiện', 'dành cho', 'giá đỡ', 'cáp', 'dây đeo'
    ]
};

/**
 * Removes Vietnamese accents (tone marks) for fuzzy matching.
 */
function removeVietnameseAccents(str: string): string {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D');
}

function calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

function uniqueTokens(tokens: string[]): string[] {
    return Array.from(new Set(tokens));
}

function isNumericToken(token: string): boolean {
    return /\d/.test(token);
}

function hasSpecIndicator(normalizedTitle: string): boolean {
    const patterns: RegExp[] = [
        /\b\d{2,4}\s?gb\b/i,
        /\b\d{1,2}\s?tb\b/i,
        /\b\d{1,2}\s?ram\b/i,
        /\b\d{1,2}(?:\.\d)?\s?(?:inch|in|inchs)\b/i,
        /\b(?:pro|max|plus|ultra|mini|v\d+)\b/i,
        /\b\d{2,4}x\d{2,4}\b/i,
    ];
    return patterns.some((pattern) => pattern.test(normalizedTitle));
}

function tokenMatchRate(titleTokens: string[], queryTokens: string[]): number {
    if (queryTokens.length === 0) return 0;

    // Use accent-neutral tokens for matching to handle query/title variations
    const neutralTitleTokens = new Set(titleTokens.map(removeVietnameseAccents));
    const neutralQueryTokens = queryTokens.map(removeVietnameseAccents);

    const matches = neutralQueryTokens.filter((t) => neutralTitleTokens.has(t)).length;
    return matches / queryTokens.length;
}

export class SearchPipelineService {
    private config: PipelineConfig;

    constructor(config?: Partial<PipelineConfig>) {
        this.config = {
            ...DEFAULT_CONFIG,
            ...config,
            stopWords: config?.stopWords ?? DEFAULT_CONFIG.stopWords,
            accessoryKeywords: config?.accessoryKeywords ?? DEFAULT_CONFIG.accessoryKeywords,
        };
    }

    public normalizeTitle(title: string): string {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9\u00C0-\u024F\u1E00-\u1EFF\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private tokenize(text: string): string[] {
        const normalized = this.normalizeTitle(text);
        if (!normalized) return [];
        return uniqueTokens(normalized.split(' ').filter(Boolean));
    }

    private buildQueryContext(query: string): {
        queryTokens: string[];
        mainKeywordTokens: string[];
        probableBrandToken: string | null;
    } {
        const queryTokens = this.tokenize(query);
        const stopWords = new Set(this.config.stopWords.map((w) => this.normalizeTitle(w)));

        const mainKeywordTokens = queryTokens.filter((token) => !stopWords.has(token));

        const probableBrandToken = mainKeywordTokens.find(
            (token) => token.length >= 3 && !isNumericToken(token)
        ) ?? null;

        return {
            queryTokens,
            mainKeywordTokens,
            probableBrandToken,
        };
    }

    public filterAccessoryKeywords(listings: Listing[], query: string): Listing[] {
        const queryTokensFiltered = this.tokenize(query).map(removeVietnameseAccents);
        const queryTokensSet = new Set(queryTokensFiltered);

        const activeAccessoryKeywords = this.config.accessoryKeywords.filter((keyword) => {
            const normalizedKeyword = removeVietnameseAccents(this.normalizeTitle(keyword));
            return !queryTokensSet.has(normalizedKeyword);
        });

        return listings.filter((listing) => {
            const title = removeVietnameseAccents(this.normalizeTitle(listing.title));
            return !activeAccessoryKeywords.some((keyword) => {
                const normalizedKeyword = removeVietnameseAccents(this.normalizeTitle(keyword));
                return normalizedKeyword.length > 0 && title.includes(normalizedKeyword);
            });
        });
    }

    public filterByBrandMatch(listings: Listing[], query: string): Listing[] {
        const context = this.buildQueryContext(query);

        if (!context.probableBrandToken) {
            return listings;
        }

        const probableBrandNeutral = removeVietnameseAccents(context.probableBrandToken);

        const filtered = listings.filter((listing) => {
            const title = this.normalizeTitle(listing.title);
            const titleNeutral = removeVietnameseAccents(title);

            if (titleNeutral.includes(probableBrandNeutral)) {
                return true;
            }

            const titleTokens = this.tokenize(title);
            const rate = tokenMatchRate(titleTokens, context.mainKeywordTokens);
            return rate >= 0.7;
        });

        return filtered.length >= Math.max(3, Math.floor(listings.length * 0.2))
            ? filtered
            : listings;
    }

    public applyPriceSanityFilter(listings: Listing[]): Listing[] {
        const prices = listings.map((l) => l.price).filter((p) => p > 0);
        if (prices.length === 0) return listings;

        const medianPrice = calculateMedian(prices);
        const minPrice = medianPrice * this.config.priceMedianMinMultiplier;
        const maxPrice = medianPrice * this.config.priceMedianMaxMultiplier;

        return listings.filter((listing) => listing.price >= minPrice && listing.price <= maxPrice);
    }

    public applyScoring(listings: Listing[], query: string): RankedListing[] {
        const context = this.buildQueryContext(query);
        const prices = listings.map((l) => l.price).filter((p) => p > 0);
        const medianPrice = calculateMedian(prices);

        const scored: RankedListing[] = listings.map((listing) => {
            const normalizedTitle = this.normalizeTitle(listing.title);
            const titleTokens = this.tokenize(normalizedTitle);
            const matchRate = tokenMatchRate(titleTokens, context.mainKeywordTokens);

            let relevanceScore = 0;

            if (context.mainKeywordTokens.length > 0 && matchRate >= this.config.tokenMatchThreshold) {
                relevanceScore += 2;
            }

            if (hasSpecIndicator(normalizedTitle)) {
                relevanceScore += 1;
            }

            if (medianPrice > 0 && Math.abs(listing.price - medianPrice) <= medianPrice * 0.5) {
                relevanceScore += 1;
            }

            const normalizedTitleNeutral = removeVietnameseAccents(normalizedTitle);
            const accessoryPenalty = this.config.accessoryKeywords.some((keyword) => {
                const normalizedKeywordNeutral = removeVietnameseAccents(this.normalizeTitle(keyword));
                return normalizedKeywordNeutral.length > 0 && normalizedTitleNeutral.includes(normalizedKeywordNeutral);
            });

            if (accessoryPenalty) {
                relevanceScore -= 5;
            }

            return {
                ...listing,
                relevanceScore,
                matchRate,
            };
        });

        return scored
            .filter((item) => item.relevanceScore >= this.config.scoreThreshold)
            .sort((a, b) => {
                if (a.price !== b.price) return a.price - b.price;
                return b.relevanceScore - a.relevanceScore;
            });
    }

    public process(listings: Listing[], query: string, limit: number = this.config.maxResults): RankedListing[] {
        if (!listings || listings.length === 0) return [];

        const accessoryFiltered = this.filterAccessoryKeywords(listings, query);
        const brandFiltered = this.filterByBrandMatch(accessoryFiltered, query);
        const sanePriced = this.applyPriceSanityFilter(brandFiltered);
        const scored = this.applyScoring(sanePriced, query);

        return scored.slice(0, Math.max(1, limit));
    }
}

export const searchPipelineService = new SearchPipelineService();
