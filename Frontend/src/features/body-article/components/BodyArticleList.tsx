import React from 'react';
import { ApproverArticleList } from '../../approver/components/ApproverArticleList';
import type { ApproverArticleListProps } from '../../fabric-article/components/FabricArticleList';

export type { ApproverArticleListProps };

const BODY_ALLOW_GROUPS = ['BODY'];

export const BodyArticleList: React.FC<ApproverArticleListProps> = ({
  hideGroups: _hideGroups,
  fabHierarchy: _fabHierarchy,
  forceStaticGroups: _forceStaticGroups,
  ...rest
}) => <ApproverArticleList {...rest} allowGroups={BODY_ALLOW_GROUPS} />;
