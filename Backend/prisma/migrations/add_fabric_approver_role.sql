-- Add FABRIC_APPROVER to the user_role enum
-- This role can submit fabric articles to SAP (ZMM_FAB_ART_CREATION_RFC)
-- and has read-only access to FG New Articles.

ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'FABRIC_APPROVER';
