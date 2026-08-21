import React from 'react';
import { FabricArticleList, type ApproverArticleListProps } from '../../fabric-article/components/FabricArticleList';

// Body Article shows only the "Body & Construction" attribute card.
// forceStaticGroups skips the API-built cardGroups so the BODY group is never replaced by the FAB-only GROUP_ORDER.
const BODY_HIDE_GROUPS = ['FAB', 'VA ACC.', 'VA PRCS', 'BUSINESS'];

export const BodyArticleList: React.FC<ApproverArticleListProps> = (props) => (
  <FabricArticleList {...props} hideGroups={BODY_HIDE_GROUPS} forceStaticGroups />
);
