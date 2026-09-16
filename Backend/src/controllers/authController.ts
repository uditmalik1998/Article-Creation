/**
 * 🔐 Auth Controller
 * Handles user authentication
 */

import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prismaClient as prisma, withPrismaRetry } from '../utils/prisma';
import { invalidateAuthUserCache } from '../middleware/auth';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const ENABLE_SINGLE_SESSION = String(process.env.ENABLE_SINGLE_SESSION || 'false').toLowerCase() === 'true';

const normalizeSubDivisionInput = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;

  const tokens = Array.isArray(value)
    ? value.map((item) => String(item || '').trim())
    : String(value)
        .split(/[;,|]+/)
        .map((item) => String(item || '').trim());

  const unique = Array.from(new Set(tokens.filter(Boolean)));
  if (unique.length === 0) return null;
  return unique.join(',');
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name, role, division, subDivision } = req.body;
    const normalizedSubDivision = normalizeSubDivisionInput(subDivision);

    // Validation
    if (!email || !password || !name) {
      res.status(400).json({ success: false, error: 'Email, password, and name are required' });
      return;
    }

    // Role-based validation
    if (role === 'CREATOR' || role === 'APPROVER') {
      if (!division || !normalizedSubDivision) {
        res.status(400).json({ success: false, error: 'Division and Sub-Division are required for Creators and Approvers' });
        return;
      }
    }

    if (role === 'CATEGORY_HEAD' && !division) {
      res.status(400).json({ success: false, error: 'Division is required for Category Head' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
      return;
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      res.status(409).json({ success: false, error: 'User already exists with this email' });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        name,
        role: role || 'USER', // Default role if not provided
        division: role === 'PO_COMMITTEE' ? null : (division || null),
        subDivision: (role === 'CATEGORY_HEAD' || role === 'PO_COMMITTEE') ? null : normalizedSubDivision,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        division: true,
        subDivision: true,
      },
    });

    const sessionIssuedAt = Date.now();

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        division: user.division,
        subDivision: user.subDivision,
        sessionIssuedAt,
      },
      JWT_SECRET,
      { expiresIn: '15d' }
    );

    res.status(201).json({
      success: true,
      data: {
        token,
        user,
      },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password are required' });
      return;
    }

    // Find user
    const user = await withPrismaRetry(() =>
      prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      })
    );

    if (!user) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ success: false, error: 'Account is disabled' });
      return;
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    const sessionIssuedAt = Date.now();

    // Update last login
    await withPrismaRetry(() =>
      prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date(sessionIssuedAt) },
      })
    );

    invalidateAuthUserCache(user.id);

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        division: user.division,
        subDivision: user.subDivision,
        sessionIssuedAt,
      },
      JWT_SECRET,
      { expiresIn: '15d' }
    );

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          division: user.division,
          subDivision: user.subDivision,
        },
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
};

export const verifyToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ success: false, error: 'No token provided' });
      return;
    }

    const decoded = jwt.verify(token, JWT_SECRET) as any;

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        lastLogin: true,
      },
    });
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: 'Invalid token' });
      return;
    }

    if (ENABLE_SINGLE_SESSION) {
      const tokenSessionIssuedAt = Number((decoded as any)?.sessionIssuedAt || 0);
      const tokenIatMs = Number((decoded as any)?.iat || 0) > 0 ? Number((decoded as any).iat) * 1000 : 0;
      const tokenIssuedAtMs = tokenSessionIssuedAt > 0 ? tokenSessionIssuedAt : tokenIatMs;

      if (tokenIssuedAtMs > 0 && user.lastLogin) {
        const dbLastLoginMs = new Date(user.lastLogin).getTime();
        if (dbLastLoginMs > tokenIssuedAtMs) {
          res.status(401).json({ success: false, error: 'Session expired. Please login again.' });
          return;
        }
      }
    }

    res.json({ success: true, data: { user } });
  } catch (error: any) {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

/**
 * Get current user info (protected route)
 * Requires authentication middleware
 */
export const getCurrentUser = async (req: Request, res: Response): Promise<void> => {
  try {
    // User is already attached by authenticate middleware
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated' });
      return;
    }

    // Fetch fresh user data from database
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        division: true,
        subDivision: true,
        isActive: true,
        createdAt: true,
        lastLogin: true,
      },
    });

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        id: user.id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        division: user.division,
        subDivision: user.subDivision,
        createdAt: user.createdAt.toISOString(),
        lastLogin: user.lastLogin?.toISOString(),
      }
    });
  } catch (error: any) {
    console.error('Get current user error:', error);
    res.status(500).json({ success: false, error: 'Failed to get user info' });
  }
};
