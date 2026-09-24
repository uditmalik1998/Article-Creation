import ApproverDashboard from '../../approver/pages/ApproverDashboard';

interface GMArticleDashboardProps {
  pathType?: 'old' | 'new' | 'rejected' | 'created' | 'failed';
}

export default function GMArticleDashboard({ pathType }: GMArticleDashboardProps = {}) {
  return (
    <ApproverDashboard
      pathType={pathType}
      baseRoute="/gm-article"
      presentationsType="FG Article"
    />
  );
}
