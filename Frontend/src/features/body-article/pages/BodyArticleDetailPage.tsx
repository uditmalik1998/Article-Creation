import { BodyArticleList } from '../components/BodyArticleList';
import ArticleDetailPage from '../../fabric-article/pages/FabricArticleDetailPage';

export type { DetailFilters, DetailNavigationState } from '../../fabric-article/pages/FabricArticleDetailPage';

export default function BodyArticleDetailPage() {
  return <ArticleDetailPage ListComponent={BodyArticleList} />;
}
