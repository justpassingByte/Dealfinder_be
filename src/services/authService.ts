import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { db } from '../config/db';

const SALT_ROUNDS = 12;

// ─── Types ──────────────────────────────────────────────────
export interface UserRow {
    id: string;
    email: string;
    password_hash: string;
    referrer_id: string | null;
    created_at: Date;
}

export interface AuthPayload {
    userId: string;
    email: string;
}

export interface TokenPair {
    token: string;
    user: { id: string; email: string };
}

// ─── Password helpers ───────────────────────────────────────
export async function hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
}

// ─── JWT helpers ────────────────────────────────────────────
export function generateToken(payload: AuthPayload): string {
    const options: jwt.SignOptions = {
        expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    };
    return jwt.sign(payload as object, config.jwtSecret, options);
}

export function verifyToken(token: string): AuthPayload {
    return jwt.verify(token, config.jwtSecret) as AuthPayload;
}

// ─── DB operations ──────────────────────────────────────────
export async function findUserByEmail(email: string): Promise<UserRow | null> {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    return result.rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] ?? null;
}

export async function createUser(email: string, passwordHash: string, referrerId?: string | null): Promise<UserRow> {
    const result = await db.query(
        `INSERT INTO users (email, password_hash, referrer_id)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [email.toLowerCase(), passwordHash, referrerId ?? null]
    );
    return result.rows[0];
}

/**
 * Register a new user. Returns a JWT token + user info.
 */
export async function registerUser(
    email: string,
    password: string,
    referrerId?: string | null
): Promise<TokenPair> {
    const existing = await findUserByEmail(email);
    if (existing) {
        throw new Error('Email already registered.');
    }

    const hash = await hashPassword(password);
    const user = await createUser(email, hash, referrerId);

    const token = generateToken({ userId: user.id, email: user.email });
    return { token, user: { id: user.id, email: user.email } };
}

/**
 * Log in a user. Returns a JWT token + user info.
 */
export async function loginUser(email: string, password: string): Promise<TokenPair> {
    const user = await findUserByEmail(email);
    if (!user) {
        throw new Error('Invalid email or password.');
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
        throw new Error('Invalid email or password.');
    }

    const token = generateToken({ userId: user.id, email: user.email });
    return { token, user: { id: user.id, email: user.email } };
}
