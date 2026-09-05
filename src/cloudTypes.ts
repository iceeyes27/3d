import type { ProfileEnvelope, ProfileSummary } from './profiles'
import type { LearningProgress } from './types'

export interface CloudSpace {
  id: string
  createdAt: number
}

export interface CloudProfileSummary extends ProfileSummary {
  spaceId: string
}

export interface CloudProfileEnvelope extends ProfileEnvelope {
  spaceId: string
}

export interface CloudFailure {
  ok: false
  code: string
  message: string
  profile?: CloudProfileEnvelope
}

export interface CloudSaveRequest {
  progress: LearningProgress
  expectedRevision: number
  mutationId: string
}

export type CloudProfileResult = { ok: true; profile: CloudProfileEnvelope; appliedRevision?: number } | CloudFailure
export type CloudEnterResult = { ok: true; profile: CloudProfileEnvelope; created: boolean } | CloudFailure
export type CloudProfileListResult = { ok: true; profiles: CloudProfileSummary[] } | CloudFailure
export type CloudSessionResult = { ok: true; space: CloudSpace } | CloudFailure
export type CloudCreateSpaceResult = { ok: true; space: CloudSpace; inviteToken: string } | CloudFailure
