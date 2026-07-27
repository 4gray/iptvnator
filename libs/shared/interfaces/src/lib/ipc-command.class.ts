import {
    STALKER_SESSION_CONTINUE,
    STALKER_SESSION_CONTROL,
    STALKER_SESSION_OPEN,
    STALKER_SESSION_REQUEST,
} from './ipc-commands';
import type {
    StalkerSessionConnectionOutcome,
    StalkerSessionContinueRequest,
    StalkerSessionControlOutcome,
    StalkerSessionControlRequest,
    StalkerSessionOpenRequest,
    StalkerSessionApplicationOperation,
    StalkerSessionRequest,
    StalkerSessionRequestOutcome,
} from './stalker-session.interface';

export interface IpcCommandContractMap {
    [STALKER_SESSION_OPEN]: {
        request: StalkerSessionOpenRequest;
        response: StalkerSessionConnectionOutcome;
    };
    [STALKER_SESSION_CONTINUE]: {
        request: StalkerSessionContinueRequest;
        response: StalkerSessionConnectionOutcome;
    };
    [STALKER_SESSION_REQUEST]: {
        request: StalkerSessionRequest;
        response: StalkerSessionRequestOutcome;
    };
    [STALKER_SESSION_CONTROL]: {
        request: StalkerSessionControlRequest;
        response: StalkerSessionControlOutcome;
    };
}

export type IpcCommandId = keyof IpcCommandContractMap;
export type IpcCommandRequest<
    Command extends IpcCommandId,
    Operation extends
        StalkerSessionApplicationOperation = StalkerSessionApplicationOperation,
> = Command extends typeof STALKER_SESSION_REQUEST
    ? StalkerSessionRequest<Operation>
    : IpcCommandContractMap[Command]['request'];
export type IpcCommandResponse<
    Command extends IpcCommandId,
    Operation extends
        StalkerSessionApplicationOperation = StalkerSessionApplicationOperation,
> = Command extends typeof STALKER_SESSION_REQUEST
    ? StalkerSessionRequestOutcome<Operation>
    : IpcCommandContractMap[Command]['response'];

export class IpcCommand<
    Command extends IpcCommandId,
    Operation extends
        StalkerSessionApplicationOperation = StalkerSessionApplicationOperation,
> {
    constructor(
        public readonly id: Command,
        public readonly callback: (
            payload: IpcCommandResponse<Command, Operation>
        ) => void
    ) {
        this.id = id;
        this.callback = callback;
    }
}
