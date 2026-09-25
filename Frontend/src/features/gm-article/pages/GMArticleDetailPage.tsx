import ArticleDetailPage from '../../approver/pages/ArticleDetailPage';

export type { DetailFilters, DetailNavigationState } from '../../approver/pages/ArticleDetailPage';

export default function GMArticleDetailPage() {
  return (
    <ArticleDetailPage
      baseRoute="/gm-article"
      extraApproverRoles={['GM_APPROVER']}
    />
  );
}
