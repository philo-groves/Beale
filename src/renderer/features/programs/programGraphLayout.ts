import type { ProgramGraphProjection } from '@shared/types';

export interface ProgramGraphLayoutRequest {
  type: 'layout';
  projection: ProgramGraphProjection;
  width: number;
  height: number;
}

export interface ProgramGraphLayoutNode {
  id: string;
  entityType: string;
  label: string;
  displayLabel: string;
  sourcePath: string | null;
  pathLabel: string;
  repositoryLabel: string | null;
  sourceGroupLabel: string | null;
  degree: number;
  radius: number;
  clusterIds: string[];
  qualityFlags: string[];
  primaryClusterId: string;
  x: number;
  y: number;
}

export interface ProgramGraphLayoutEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeKind: string;
  qualityFlags: string[];
}

export interface ProgramGraphLayoutCluster {
  id: string;
  kind: string;
  label: string;
  nodeCount: number;
  edgeCount: number;
  qualityFlags: string[];
  x: number;
  y: number;
  radius: number;
}

export interface ProgramGraphLayoutResult {
  width: number;
  height: number;
  nodes: ProgramGraphLayoutNode[];
  edges: ProgramGraphLayoutEdge[];
  clusters: ProgramGraphLayoutCluster[];
  generatedAt: string;
  durationMs: number;
}

export type ProgramGraphLayoutWorkerResponse =
  | { type: 'layout:preview'; layout: ProgramGraphLayoutResult }
  | { type: 'layout:complete'; layout: ProgramGraphLayoutResult }
  | { type: 'layout:error'; message: string };
