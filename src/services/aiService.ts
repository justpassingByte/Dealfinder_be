/**
 * AI Service — Phase 3 modules
 *
 * Product matching with TF-IDF similarity (no external ML dependencies).
 * LLM-style summarization of user reviews using extractive approach.
 * Deal detection & price anomaly via z-score analysis.
 */

import { Listing } from '../types/listing';

// ═══════════════════════════════════════════════════════════════
// 1. Product Matching with TF-IDF Similarity
// ═══════════════════════════════════════════════════════════════

interface TermVector {
    [term: string]: number;
}

/**
 * Tokenise text into lowercase terms.
 */
function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1);
}

/**
 * Build a term-frequency vector for a document.
 */
function termFrequency(tokens: string[]): TermVector {
    const tf: TermVector = {};
    for (const t of tokens) {
        tf[t] = (tf[t] || 0) + 1;
    }
    // Normalise by document length
    const len = tokens.length || 1;
    for (const t in tf) {
        tf[t] /= len;
    }
    return tf;
}

/**
 * Compute IDF across a corpus of documents.
 */
function inverseDocumentFrequency(docs: string[][]): TermVector {
    const idf: TermVector = {};
    const n = docs.length;
    for (const doc of docs) {
        const seen = new Set(doc);
        for (const term of seen) {
            idf[term] = (idf[term] || 0) + 1;
        }
    }
    for (const term in idf) {
        idf[term] = Math.log(n / idf[term]) + 1;
    }
    return idf;
}

/**
 * Compute TF-IDF vector for a document.
 */
function tfidfVector(tf: TermVector, idf: TermVector): TermVector {
    const vec: TermVector = {};
    for (const term in tf) {
        vec[term] = tf[term] * (idf[term] || 1);
    }
    return vec;
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: TermVector, b: TermVector): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;

    const allTerms = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const t of allTerms) {
        const va = a[t] || 0;
        const vb = b[t] || 0;
        dot += va * vb;
        magA += va * va;
        magB += vb * vb;
    }

    const mag = Math.sqrt(magA) * Math.sqrt(magB);
    return mag === 0 ? 0 : dot / mag;
}

export interface MatchResult {
    listing: Listing;
    similarity: number;
}

/**
 * Find the most similar listings to a query using TF-IDF cosine similarity.
 */
export function matchProducts(query: string, listings: Listing[], topN = 10): MatchResult[] {
    const queryTokens = tokenize(query);
    const allDocs = [queryTokens, ...listings.map((l) => tokenize(l.title))];
    const idf = inverseDocumentFrequency(allDocs);

    const queryVec = tfidfVector(termFrequency(queryTokens), idf);

    const scored: MatchResult[] = listings.map((listing) => {
        const tokens = tokenize(listing.title);
        const vec = tfidfVector(termFrequency(tokens), idf);
        return {
            listing,
            similarity: parseFloat(cosineSimilarity(queryVec, vec).toFixed(4)),
        };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, topN);
}

// ═══════════════════════════════════════════════════════════════
// 2. Review Summarization (Extractive)
// ═══════════════════════════════════════════════════════════════

export interface ReviewSummary {
    averageSentiment: 'positive' | 'mixed' | 'negative';
    topPositive: string[];
    topNegative: string[];
    summary: string;
    totalReviews: number;
}

// Simple positive/negative word lists for lightweight sentiment analysis
const POSITIVE_WORDS = new Set([
    'good', 'great', 'excellent', 'amazing', 'perfect', 'love', 'best',
    'awesome', 'fantastic', 'wonderful', 'happy', 'fast', 'quality',
    'recommend', 'nice', 'beautiful', 'bagus', 'mantap', 'cepat',
    'original', 'worth', 'satisfied', 'reliable', 'premium', 'superb',
    'impressive', 'outstanding', 'brilliant', 'exceptional', 'top',
]);

const NEGATIVE_WORDS = new Set([
    'bad', 'terrible', 'awful', 'poor', 'worst', 'hate', 'broken',
    'fake', 'slow', 'damaged', 'scam', 'disappointed', 'cheap',
    'refund', 'waste', 'horrible', 'jelek', 'rusak', 'palsu',
    'defective', 'fraud', 'misleading', 'overpriced', 'useless',
    'annoying', 'frustrating', 'unreliable',
]);

function sentimentScore(text: string): number {
    const words = tokenize(text);
    let score = 0;
    for (const w of words) {
        if (POSITIVE_WORDS.has(w)) score += 1;
        if (NEGATIVE_WORDS.has(w)) score -= 1;
    }
    return score;
}

/**
 * Summarise an array of review texts using extractive sentiment analysis.
 */
export function summarizeReviews(reviews: string[]): ReviewSummary {
    if (reviews.length === 0) {
        return {
            averageSentiment: 'mixed',
            topPositive: [],
            topNegative: [],
            summary: 'No reviews available.',
            totalReviews: 0,
        };
    }

    const scored = reviews.map((r) => ({ text: r, score: sentimentScore(r) }));
    const avgScore = scored.reduce((sum, r) => sum + r.score, 0) / scored.length;

    // Sort for positive and negative extremes
    const positive = scored
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((r) => r.text);

    const negative = scored
        .filter((r) => r.score < 0)
        .sort((a, b) => a.score - b.score)
        .slice(0, 3)
        .map((r) => r.text);

    const positiveCount = scored.filter((r) => r.score > 0).length;
    const negativeCount = scored.filter((r) => r.score < 0).length;
    const neutralCount = scored.filter((r) => r.score === 0).length;

    const sentiment: 'positive' | 'mixed' | 'negative' =
        avgScore > 0.5 ? 'positive' : avgScore < -0.5 ? 'negative' : 'mixed';

    const summary = `Out of ${reviews.length} reviews: ${positiveCount} positive, ${negativeCount} negative, ${neutralCount} neutral. Overall sentiment is ${sentiment}.`;

    return {
        averageSentiment: sentiment,
        topPositive: positive,
        topNegative: negative,
        summary,
        totalReviews: reviews.length,
    };
}

// ═══════════════════════════════════════════════════════════════
// 3. Deal Detection & Price Anomaly (Z-Score)
// ═══════════════════════════════════════════════════════════════

export interface DealAlert {
    listing: Listing;
    priceZScore: number;
    anomalyType: 'great_deal' | 'overpriced' | 'normal';
    savingsPercent: number;
}

export interface DealDetectionResult {
    meanPrice: number;
    stdDev: number;
    alerts: DealAlert[];
}

/**
 * Detect price anomalies and deals using z-score analysis.
 * Z-score < -1.5 → great_deal (significantly below average)
 * Z-score > 1.5  → overpriced (significantly above average)
 */
export function detectDeals(listings: Listing[], threshold = 1.5): DealDetectionResult {
    if (listings.length === 0) {
        return { meanPrice: 0, stdDev: 0, alerts: [] };
    }

    const prices = listings.map((l) => l.price);
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);

    const alerts: DealAlert[] = listings.map((listing) => {
        const zScore = stdDev === 0 ? 0 : (listing.price - mean) / stdDev;
        const savingsPercent = mean === 0 ? 0 : parseFloat(((1 - listing.price / mean) * 100).toFixed(1));

        let anomalyType: 'great_deal' | 'overpriced' | 'normal' = 'normal';
        if (zScore < -threshold) anomalyType = 'great_deal';
        else if (zScore > threshold) anomalyType = 'overpriced';

        return {
            listing,
            priceZScore: parseFloat(zScore.toFixed(3)),
            anomalyType,
            savingsPercent,
        };
    });

    // Sort: great deals first, then normal, then overpriced
    const order = { great_deal: 0, normal: 1, overpriced: 2 };
    alerts.sort((a, b) => order[a.anomalyType] - order[b.anomalyType]);

    return {
        meanPrice: parseFloat(mean.toFixed(2)),
        stdDev: parseFloat(stdDev.toFixed(2)),
        alerts,
    };
}
