import type {
  BreakoutRoomMemberStatus,
  BreakoutRoomRecord,
  BreakoutRoomStatus,
  RunStatus
} from '@shared/types';

export function resolvedBreakoutRoomStatus(
  room: Pick<BreakoutRoomRecord, 'phase' | 'status'>,
  members: readonly Pick<{ status: BreakoutRoomMemberStatus }, 'status'>[],
  runStatus?: RunStatus
): BreakoutRoomStatus {
  if (room.phase === 'completed' || room.status === 'completed') return 'completed';
  if (runStatus !== undefined && runStatus !== 'active') {
    return room.status === 'errored' || members.some((member) => member.status === 'errored')
      ? 'errored'
      : 'interrupted';
  }
  if (members.some((member) => member.status === 'active' || member.status === 'pending')) return 'active';
  if (room.status === 'errored' || members.some((member) => member.status === 'errored')) return 'errored';
  if (room.status === 'interrupted' || members.some((member) => member.status === 'interrupted')) return 'interrupted';
  return room.status;
}
