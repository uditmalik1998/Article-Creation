/**
 * Article-type access set on Admin › Users (users.article_types). A user with no
 * article types keeps today's role-only behaviour; otherwise only the picked
 * areas show and can be approved. ADMIN is never restricted. The backend
 * enforces the same rule (middleware/auth.ts hasArticleTypeAccess).
 */
export type ArticleType = 'FG' | 'FABRIC' | 'GM';

type UserLike = { role?: string | null; articleTypes?: unknown } | null | undefined;

const APPROVAL_ROLES = ['ADMIN', 'APPROVER', 'CATEGORY_HEAD', 'SUB_DIVISION_HEAD', 'PO_COMMITTEE', 'PD'];

export const userArticleTypes = (user: UserLike): string[] =>
  Array.isArray(user?.articleTypes) ? (user!.articleTypes as string[]) : [];

export const canAccessArticleType = (user: UserLike, type: ArticleType): boolean => {
  if (user?.role === 'ADMIN') return true;
  const types = userArticleTypes(user);
  return types.length === 0 || types.includes(type);
};

/** Fabric SAP submit: ADMIN, or an approver role that has the Fabric Article type. */
export const canApproveFabricByType = (user: UserLike): boolean =>
  user?.role === 'ADMIN' ||
  (APPROVAL_ROLES.includes(String(user?.role ?? '')) && userArticleTypes(user).includes('FABRIC'));

/** Which article area a route path belongs to, if any. */
export const articleTypeForPath = (pathname: string): ArticleType | null => {
  if (pathname === '/approver' || pathname.startsWith('/approver/')) return 'FG';
  if (pathname === '/fabric-article' || pathname.startsWith('/fabric-article/')) return 'FABRIC';
  if (pathname === '/gm-article' || pathname.startsWith('/gm-article/')) return 'GM';
  return null;
};
