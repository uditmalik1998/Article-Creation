import FabricArticleDetailPage from './FabricArticleDetailPage';

export type { DetailFilters, DetailNavigationState } from './FabricArticleDetailPage';

export default function FGNewArticleDetailPage() {
  return (
    <FabricArticleDetailPage
      itemsBaseEndpoint="/approver/fabric-article-data"
      approveEndpoint="/approver/fabric-article-data/submit"
      rejectEndpoint="/approver/fabric-article-data/delete"
      approveRoles={['ADMIN', 'FABRIC_APPROVER']}
      isFGMode
    />
  );
}
