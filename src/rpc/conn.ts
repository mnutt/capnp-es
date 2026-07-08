// Based on https://github.com/jdiaz5513/capnp-ts (MIT - Julián Díaz)

import { IDGen } from "./idgen";
import { RefCount } from "./refcount";
import { Client, isSameClient, clientFromResolution } from "./client";
import { Transport } from "./transport";
import { Question, QuestionState } from "./question";
import {
  Return,
  Payload,
  CapDescriptor,
  MessageTarget,
  Resolve,
  Disembargo_Context_Which,
  Call_SendResultsTo_Which,
} from "../capnp/rpc";
import {
  RPCError,
  RpcProtocolError,
  RpcProtocolErrorKind,
  toException,
} from "./rpc-error";
import { AnswerEntry, Answer } from "./answer";
import {
  newMessage,
  newDisembargoMessage,
  newFinishMessage,
  newReleaseMessage,
  newResolveMessage,
  newUnimplementedMessage,
  newReturnMessage,
  setResolveException,
  setReturnException,
} from "./capability";
import { Pipeline } from "./pipeline";
import { Struct } from "../serialization/pointers/struct";
import {
  promisedAnswerOpsToTransform,
  transformToPromisedAnswer,
} from "./promised-answer";
import { Method } from "./method";
import { PipelineOp } from "./pipeline-op";
import { ImportClient } from "./import-client";
import { Call, placeParams } from "./call";
import { Segment } from "../serialization/segment";
import { List } from "../serialization/pointers/list/list";
import { Ref } from "./ref";
import { PipelineClient } from "./pipeline-client";
import { FixedAnswer } from "./fixed-answer";
import { LocalAnswerClient } from "./local-answer-client";
import { Finalize, runTrackedFinalizer } from "./finalize";
import { Message as RPCMessage } from "../capnp/rpc";
import { MethodError } from "./method-error";
import { Registry } from "./registry";
import { joinAnswer } from "./join";
import {
  INVARIANT_UNREACHABLE_CODE,
  RPC_BAD_TARGET,
  RPC_NO_MAIN_INTERFACE,
  RPC_QUESTION_ID_REUSED,
  RPC_RETURN_FOR_UNKNOWN_QUESTION,
  RPC_UNKNOWN_ANSWER_ID,
  RPC_UNKNOWN_CAP_DESCRIPTOR,
  RPC_UNKNOWN_EXPORT_ID,
  RPC_UNIMPLEMENTED,
} from "../errors";
import { format } from "../util";
import { Interface, Message } from "../serialization";
import { AnyStruct } from "../serialization/pointers/struct";
import {
  InterfaceCtor,
  ServerTarget,
} from "../serialization/pointers/interface";
import { Server } from "./server";
import { getAs } from "../serialization/pointers/struct.utils";
import { ErrorClient } from "./error-client";
import { Pointer } from "../serialization/pointers/pointer";
import { PromiseExportClient } from "./promise-export-client";
import { setInterfacePointer } from "../serialization/pointers/pointer.utils";

type QuestionSlot = Question<any, any> | null;

// https://github.com/unjs/capnp-es/issues/7
const ConnWeakRefRegistry = globalThis.FinalizationRegistry
  ? new FinalizationRegistry<() => void>((cb) => runTrackedFinalizer(cb))
  : undefined;

const ConDefaultFinalize: Finalize = (obj, finalizer): void => {
  ConnWeakRefRegistry?.register(obj, finalizer);
};

function protocolError(
  kind: RpcProtocolErrorKind,
  message: string,
): RpcProtocolError {
  return new RpcProtocolError(kind, message);
}

function nonProtocolError(error_: unknown): Error {
  if (error_ instanceof RpcProtocolError) {
    throw error_;
  }

  return error_ instanceof Error ? error_ : new Error(String(error_));
}

export class Conn {
  questionID = new IDGen();
  questions: QuestionSlot[] = [];

  answers: { [key: number]: AnswerEntry<any> } = {};

  exportID = new IDGen();
  exports: Array<Export | null> = [];

  imports: { [key: number]: ImportEntry } = {};
  disembargoID = new IDGen();
  disembargoes: { [key: number]: ImportClient } = {};
  tailAnswerWaiters: { [key: number]: Array<Question<any, any>> } = {};
  exportPromises: { [key: number]: ExportPromiseEntry } = {};
  exportPromiseIndex = new WeakMap<Question<any, any>, Map<string, number>>();

  onError?: (err?: Error) => void;
  main?: Client;
  working = false;
  closed = false;

  /**
   * Create a new connection
   * @param transport The transport used to receive/send messages.
   * @param finalize Weak reference implementation. Compatible with
   * the 'weak' module on node.js (just add weak as a dependency and pass
   * require("weak")), but alternative implementations can be provided for
   * other platforms like Electron. Defaults to using FinalizationRegistry if
   * available.
   * @returns A new connection.
   */
  constructor(
    public transport: Transport,
    public finalize = ConDefaultFinalize,
  ) {
    this.startWork();
  }

  bootstrap<C>(InterfaceClass: InterfaceCtor<C, Server>): C {
    const q = this.newQuestion();
    const msg = newMessage();
    const boot = msg._initBootstrap();
    boot.questionId = q.id;

    this.sendMessage(msg);
    q.start();
    return new InterfaceClass.Client(new Pipeline(AnyStruct, q).client());
  }

  initMain<S extends InterfaceCtor<unknown, Server>>(
    InterfaceClass: S,
    target: ServerTarget<S>,
  ): void {
    this.main = new InterfaceClass.Server(target);
    this.addExport(this.main);
  }

  startWork(): void {
    this.work().catch((error_) => {
      if (this.onError) {
        this.onError(error_);
      } else if (error_ !== undefined) {
        throw error_;
      }
    });
  }

  sendReturnException(id: number, err: Error): void {
    const m = newReturnMessage(id);
    setReturnException(m.return, err);
    this.sendMessage(m);
  }

  handleBootstrapMessage(m: RPCMessage): void {
    const boot = m.bootstrap;
    const id = boot.questionId;
    const ret = newReturnMessage(id);
    ret.return.releaseParamCaps = false;
    const a = this.insertAnswer(id);
    if (a === null) {
      return this.sendReturnException(id, new Error(RPC_QUESTION_ID_REUSED));
    }
    if (this.main === undefined) {
      return a.reject(new Error(RPC_NO_MAIN_INTERFACE));
    }

    const msg = new Message();
    const capId = msg.addCap(this.main);
    const root = new Interface(msg.getSegment(0), 0);
    setInterfacePointer(capId, root);
    a.fulfill(root);
  }

  handleFinishMessage(m: RPCMessage): void {
    const { finish } = m;
    const id = finish.questionId;
    const a = this.popAnswer(id);
    if (a === null) {
      // Safe to ignore: noFinishNeeded cleanup already removed the answer entry, so there is
      // no remaining table-owned result capability for this finish message to release.
      return;
    }
    if (finish.releaseResultCaps) {
      const caps = a.resultCaps;
      let i = caps.length;
      while (--i >= 0) {
        this.releaseExport(caps[i], 1);
      }
    }
  }

  handleResolveMessage(m: RPCMessage): void {
    const resolve = m.resolve;
    const promiseId = resolve.promiseId;
    const entry = this.imports[promiseId];
    if (!entry) {
      // Safe to ignore after cleanup below: release already removed this promise import, and any
      // newly-introduced capability in the late resolve is discarded before returning.
      if (resolve.which() === Resolve.CAP) {
        try {
          this.discardResolvedCap(resolve.cap);
        } catch (error_) {
          nonProtocolError(error_);
          this.sendMessage(newUnimplementedMessage(m));
        }
      }
      return;
    }

    const importClient = entry.rc._client;
    if (!(importClient instanceof ImportClient)) {
      throw new TypeError(INVARIANT_UNREACHABLE_CODE);
    }
    if (!entry.isPromise) {
      // Safe to ignore after cleanup below: the import already has a terminal target, and any
      // newly-introduced capability in the duplicate resolve is discarded before returning.
      if (resolve.which() === Resolve.CAP) {
        try {
          this.discardResolvedCap(resolve.cap);
        } catch (error_) {
          nonProtocolError(error_);
          this.sendMessage(newUnimplementedMessage(m));
        }
      }
      return;
    }

    switch (resolve.which()) {
      case Resolve.CAP: {
        const wasPromise = entry.isPromise;
        entry.isPromise = false;
        let client: Client;
        try {
          client = this.clientFromCapDescriptor(resolve.cap);
        } catch (error_) {
          const err = nonProtocolError(error_);
          this.sendMessage(newUnimplementedMessage(m));
          importClient.setResolved(new ErrorClient(err));
          break;
        }
        importClient.setResolved(client);
        if (wasPromise && this.capDescriptorNeedsSenderLoopback(resolve.cap)) {
          const embargoId = this.registerDisembargo(importClient);
          importClient.activateEmbargo(embargoId);
          const out = newDisembargoMessage(
            Disembargo_Context_Which.SENDER_LOOPBACK,
            embargoId,
          );
          out.disembargo._initTarget().importedCap = promiseId;
          this.sendMessage(out);
        }
        break;
      }
      case Resolve.EXCEPTION: {
        entry.isPromise = false;
        importClient.setResolved(
          new ErrorClient(new RPCError(resolve.exception)),
        );
        break;
      }
      default: {
        entry.isPromise = false;
        importClient.setResolved(new ErrorClient(new Error(RPC_UNIMPLEMENTED)));
      }
    }
  }

  capDescriptorNeedsSenderLoopback(desc: CapDescriptor): boolean {
    return (
      desc.which() === CapDescriptor.RECEIVER_HOSTED ||
      desc.which() === CapDescriptor.RECEIVER_ANSWER
    );
  }

  handleReleaseMessage(m: RPCMessage): void {
    const rel = m.release;
    this.releaseExport(rel.id, rel.referenceCount);
  }

  handleDisembargoMessage(m: RPCMessage): void {
    const dis = m.disembargo;
    const ctx = dis.context;
    switch (ctx.which()) {
      case Disembargo_Context_Which.SENDER_LOOPBACK: {
        const out = newDisembargoMessage(
          Disembargo_Context_Which.RECEIVER_LOOPBACK,
          ctx.senderLoopback,
        );
        out.disembargo.target = dis.target;
        this.sendMessage(out);
        break;
      }
      case Disembargo_Context_Which.RECEIVER_LOOPBACK: {
        const id = ctx.receiverLoopback;
        const client = this.disembargoes[id];
        if (!client) {
          break;
        }
        delete this.disembargoes[id];
        this.disembargoID.remove(id);
        client.liftEmbargo(id);
        break;
      }
      default: {
        // Level 3+ contexts are unsupported in this implementation.
        this.sendMessage(newUnimplementedMessage(m));
      }
    }
  }

  handleMessage(m: RPCMessage): void {
    try {
      this.dispatchMessage(m);
    } catch (error_) {
      if (error_ instanceof RpcProtocolError) {
        this.abortForProtocolError(error_);
        return;
      }
      throw error_;
    }
  }

  private dispatchMessage(m: RPCMessage): void {
    switch (m.which()) {
      case RPCMessage.UNIMPLEMENTED: {
        // no-op for now to avoid feedback loop
        break;
      }
      case RPCMessage.BOOTSTRAP: {
        this.handleBootstrapMessage(m);
        break;
      }
      case RPCMessage.ABORT: {
        this.shutdown(new RPCError(m.abort));
        break;
      }
      case RPCMessage.FINISH: {
        this.handleFinishMessage(m);
        break;
      }
      case RPCMessage.RESOLVE: {
        this.handleResolveMessage(m);
        break;
      }
      case RPCMessage.RELEASE: {
        this.handleReleaseMessage(m);
        break;
      }
      case RPCMessage.DISEMBARGO: {
        this.handleDisembargoMessage(m);
        break;
      }
      case RPCMessage.OBSOLETE_SAVE:
      case RPCMessage.OBSOLETE_DELETE:
      case RPCMessage.PROVIDE:
      case RPCMessage.ACCEPT:
      case RPCMessage.JOIN: {
        this.sendMessage(newUnimplementedMessage(m));
        break;
      }
      case RPCMessage.RETURN: {
        // Make a copy to allow `m` to fall out of scope for GC and finalization
        // this.handleReturnMessage(m.segment.message.copy().initRoot(RPCMessage));
        this.handleReturnMessage(m);
        break;
      }
      case RPCMessage.CALL: {
        // Make a copy to allow `m` to fall out of scope for GC and finalization
        // this.handleCallMessage(m.segment.message.copy().initRoot(RPCMessage));
        this.handleCallMessage(m);
        break;
      }
      default:
      // Unknown message variants are intentionally ignored for compatibility with peers that know
      // newer protocol extensions.
    }
  }

  private abortForProtocolError(err: RpcProtocolError): void {
    if (this.closed) {
      return;
    }
    try {
      const m = newMessage();
      toException(m._initAbort(), err);
      this.sendMessage(m);
    } catch {
      // Shutdown cleanup is more important than preserving the abort send path.
    }
    this.shutdown(err);
  }

  handleReturnMessage(m: RPCMessage): void {
    const ret = m.return;
    const id = ret.answerId;
    const q = this.popQuestion(id);
    if (!q) {
      this.abortForProtocolError(
        protocolError(
          RpcProtocolErrorKind.ReturnForUnknownQuestion,
          format(RPC_RETURN_FOR_UNKNOWN_QUESTION, id),
        ),
      );
      return;
    }

    if (ret.releaseParamCaps) {
      for (let i = 0; i < q.paramCaps.length; i++) {
        this.releaseExport(q.paramCaps[i], 1);
      }
    }

    let releaseResultCaps = true;
    switch (ret.which()) {
      case Return.RESULTS: {
        releaseResultCaps = false;
        const { results } = ret;
        try {
          this.populateMessageCapTable(results);
        } catch (error_) {
          try {
            const err = nonProtocolError(error_);
            this.sendMessage(newUnimplementedMessage(m));
            q.reject(err);
          } catch (protocolError_) {
            q.reject(protocolError_ as Error);
            throw protocolError_;
          }
          break;
        }

        const { content } = results;
        q.fulfill(content);
        break;
      }
      case Return.EXCEPTION: {
        const exc = ret.exception;
        const err: Error = q.method
          ? new MethodError(q.method, exc)
          : new RPCError(exc);
        q.reject(err);
        break;
      }
      case Return.CANCELED: {
        q.reject(new Error("call canceled by remote"));
        break;
      }
      case Return.TAKE_FROM_OTHER_QUESTION: {
        const otherQuestionId = ret.takeFromOtherQuestion;
        if (otherQuestionId === id) {
          q.reject(new Error(RPC_BAD_TARGET));
          break;
        }
        const source = this.answers[otherQuestionId];
        if (!source) {
          q.reject(new Error(RPC_BAD_TARGET));
          break;
        }
        if (source.done) {
          if (source.err) {
            q.reject(source.err);
          } else if (source.obj) {
            q.fulfill(source.obj);
          } else {
            q.reject(new Error(RPC_BAD_TARGET));
          }
          break;
        }
        if (!this.tailAnswerWaiters[otherQuestionId]) {
          this.tailAnswerWaiters[otherQuestionId] = [];
        }
        this.tailAnswerWaiters[otherQuestionId].push(q);
        break;
      }
      case Return.RESULTS_SENT_ELSEWHERE: {
        q.reject(new Error(RPC_UNIMPLEMENTED));
        break;
      }
      default: {
        q.reject(new Error(RPC_UNIMPLEMENTED));
        break;
      }
    }

    if (!ret.noFinishNeeded) {
      const fin = newFinishMessage(id, releaseResultCaps);
      this.sendMessage(fin);
    }
  }

  handleCallMessage(m: RPCMessage): void {
    const mcall = m.call;
    const id = mcall.questionId;
    const mt = mcall.target;
    if (
      mt.which() !== MessageTarget.IMPORTED_CAP &&
      mt.which() !== MessageTarget.PROMISED_ANSWER
    ) {
      throw protocolError(RpcProtocolErrorKind.BadTarget, RPC_BAD_TARGET);
    }

    const mparams = mcall.params;
    try {
      this.populateMessageCapTable(mparams);
    } catch (error_) {
      this.sendReturnException(id, nonProtocolError(error_));
      return;
    }

    const a = this.insertAnswer(id);
    if (!a) {
      this.abortForProtocolError(
        protocolError(
          RpcProtocolErrorKind.QuestionIdReused,
          format(RPC_QUESTION_ID_REUSED, id),
        ),
      );
      return;
    }
    switch (mcall.sendResultsTo.which()) {
      case Call_SendResultsTo_Which.CALLER: {
        break;
      }
      case Call_SendResultsTo_Which.YOURSELF: {
        a.sendResultsElsewhere = true;
        break;
      }
      default: {
        this.popAnswer(id);
        this.sendReturnException(id, new Error(RPC_UNIMPLEMENTED));
        return;
      }
    }

    const interfaceDef = Registry.lookup(mcall.interfaceId);
    if (!interfaceDef) {
      this.popAnswer(id);
      this.sendReturnException(id, new Error(RPC_UNIMPLEMENTED));
      return;
    }

    const methodTable: typeof interfaceDef.methods =
      "ownMethods" in interfaceDef
        ? (interfaceDef.ownMethods as typeof interfaceDef.methods)
        : interfaceDef.methods;
    const method = methodTable[mcall.methodId];
    if (!method) {
      this.popAnswer(id);
      this.sendReturnException(id, new Error(RPC_UNIMPLEMENTED));
      return;
    }

    const paramContent = mparams.content;

    const call: Call<any, any> = {
      method,

      params: getAs(method.ParamsClass, paramContent),
    };
    try {
      this.routeCallMessage(a, mt, call);
    } catch (error_) {
      a.reject(nonProtocolError(error_));
    }
  }

  routeCallMessage<P extends Struct, R extends Struct>(
    result: AnswerEntry<R>,
    mt: MessageTarget,
    cl: Call<P, R>,
  ): void {
    switch (mt.which()) {
      case MessageTarget.IMPORTED_CAP: {
        const id = mt.importedCap;
        const e = this.findExport(id);
        if (!e) {
          throw protocolError(RpcProtocolErrorKind.BadTarget, RPC_BAD_TARGET);
        }
        const answer = this.call(e.client, cl);
        joinAnswer(result, answer);
        break;
      }
      case MessageTarget.PROMISED_ANSWER: {
        const mpromise = mt.promisedAnswer;
        const id = mpromise.questionId;
        if (id === result.id) {
          // Grandfather paradox
          throw protocolError(RpcProtocolErrorKind.BadTarget, RPC_BAD_TARGET);
        }
        const pa = this.answers[id] as AnswerEntry<R>;
        if (!pa) {
          throw protocolError(RpcProtocolErrorKind.BadTarget, RPC_BAD_TARGET);
        }
        const mtrans = mpromise.transform;
        const transform = promisedAnswerOpsToTransform(mtrans);
        if (pa.done) {
          const { obj, err } = pa;
          const client = clientFromResolution(transform, obj, err);
          const answer = this.call(client, cl);
          joinAnswer(result, answer);
        } else {
          pa.queueCall(cl, transform, result);
        }

        break;
      }
      default: {
        throw new Error(INVARIANT_UNREACHABLE_CODE);
      }
    }
  }

  populateMessageCapTable(payload: Payload): void {
    const msg = payload.segment.message;
    const ctab = payload.capTable;
    for (const desc of ctab) {
      switch (desc.which()) {
        case CapDescriptor.NONE: {
          msg.addCap(null);
          break;
        }
        case CapDescriptor.SENDER_HOSTED: {
          const id = desc.senderHosted;
          const client = this.addImport(id, false);
          msg.addCap(client);
          break;
        }
        case CapDescriptor.SENDER_PROMISE: {
          // Apparently, this is a hack, see https://sourcegraph.com/github.com/capnproto/go-capnproto2@e1ae1f982d9908a41db464f02861a850a0880a5a/-/blob/rpc/rpc.go#L549
          const id = desc.senderPromise;
          const client = this.addImport(id, true);
          msg.addCap(client);
          break;
        }
        case CapDescriptor.RECEIVER_HOSTED: {
          const id = desc.receiverHosted;
          const e = this.findExport(id);
          if (!e) {
            throw protocolError(
              RpcProtocolErrorKind.UnknownExportId,
              format(RPC_UNKNOWN_EXPORT_ID, id),
            );
          }
          try {
            msg.addCap(e.rc.ref());
          } catch (error_) {
            throw protocolError(
              RpcProtocolErrorKind.UnknownExportId,
              (error_ as Error).message,
            );
          }
          break;
        }
        case CapDescriptor.RECEIVER_ANSWER: {
          const recvAns = desc.receiverAnswer;
          const id = recvAns.questionId;
          const a = this.answers[id];
          if (!a) {
            throw protocolError(
              RpcProtocolErrorKind.UnknownAnswerId,
              format(RPC_UNKNOWN_ANSWER_ID, id),
            );
          }
          const recvTransform = recvAns.transform;
          const transform = promisedAnswerOpsToTransform(recvTransform);
          msg.addCap(answerPipelineClient(a, transform));
          break;
        }
        default: {
          throw protocolError(
            RpcProtocolErrorKind.UnknownCapDescriptor,
            format(RPC_UNKNOWN_CAP_DESCRIPTOR, desc.which()),
          );
        }
      }
    }
  }

  addImport(id: number, isPromise = false): Client {
    const importEntry = this.imports[id];
    if (importEntry) {
      importEntry.refs++;
      importEntry.isPromise = importEntry.isPromise || isPromise;
      return importEntry.rc.ref();
    }
    const client = new ImportClient(this, id);
    const [rc, ref] = RefCount.new(client, this.finalize);
    this.imports[id] = {
      rc,
      refs: 1,
      isPromise,
    };
    return ref;
  }

  releaseImport(id: number, refs: number): void {
    const entry = this.imports[id];
    if (!entry) {
      return;
    }
    if (refs <= 0) {
      this.error(
        `warning: import ${id} release with non-positive count (${refs}) ignored`,
      );
      return;
    }
    const heldRefs = entry.refs;
    const releaseCount = Math.max(0, Math.min(refs, heldRefs));
    entry.refs -= releaseCount;
    if (entry.refs > 0) {
      return;
    }
    if (refs > heldRefs) {
      this.error(
        `warning: import ${id} release overrun (requested ${refs}, held ${heldRefs})`,
      );
    }
    this.clearDisembargo(entry.rc._client);
    delete this.imports[id];
    if (releaseCount > 0) {
      this.sendMessage(newReleaseMessage(id, releaseCount));
    }
  }

  releaseImportAll(id: number): void {
    const entry = this.imports[id];
    if (!entry) {
      return;
    }
    this.releaseImport(id, entry.refs);
  }

  registerDisembargo(client: ImportClient): number {
    const id = this.disembargoID.next();
    this.disembargoes[id] = client;
    return id;
  }

  clearDisembargo(client: Client): void {
    for (const [idStr, c] of Object.entries(this.disembargoes)) {
      if (c === client) {
        const id = Number(idStr);
        delete this.disembargoes[id];
        this.disembargoID.remove(id);
      }
    }
  }

  findExport(id: number): Export | null {
    if (id >= this.exports.length) {
      return null;
    }
    return this.exports[id];
  }

  addExport(client: Client): number {
    for (let i = 0; i < this.exports.length; i++) {
      const e = this.exports[i];
      if (e && isSameClient(e.rc._client, client)) {
        e.wireRefs++;
        return i;
      }
    }

    const id = this.exportID.next();
    const [rc, ref] = RefCount.new(client, this.finalize);
    const _export: Export = {
      client: ref,
      id,
      rc,
      wireRefs: 1,
    };
    if (id === this.exports.length) {
      this.exports.push(_export);
    } else {
      this.exports[id] = _export;
    }
    return id;
  }

  releaseExport(id: number, refs: number): void {
    const e = this.findExport(id);
    if (!e) {
      return;
    }
    if (refs <= 0) {
      this.error(
        `warning: export ${id} release with non-positive count (${refs}) ignored`,
      );
      return;
    }
    const heldRefs = e.wireRefs;
    const releaseCount = Math.max(0, Math.min(refs, heldRefs));
    e.wireRefs -= releaseCount;
    if (e.wireRefs > 0) {
      return;
    }
    if (refs > heldRefs) {
      this.error(
        `warning: export ${id} release overrun (requested ${refs}, held ${heldRefs})`,
      );
    }
    delete this.exportPromises[id];
    e.client.close();
    this.exports[id] = null;
    this.exportID.remove(id);
  }

  error(s: string): void {
    console.error(s);
  }

  newQuestion<CallParams extends Struct, CallResults extends Struct>(
    method?: Method<CallParams, CallResults>,
  ): Question<CallParams, CallResults> {
    const id = this.questionID.next();
    const q = new Question(this, id, method);
    if (id === this.questions.length) {
      this.questions.push(q);
    } else {
      this.questions[id] = q;
    }
    return q;
  }

  findQuestion<P extends Struct, R extends Struct>(
    id: number,
  ): Question<P, R> | null {
    if (id >= this.questions.length) {
      return null;
    }
    return this.questions[id];
  }

  popQuestion<P extends Struct, R extends Struct>(
    id: number,
  ): Question<P, R> | null {
    const q = this.findQuestion<P, R>(id);
    if (!q) {
      return q;
    }
    this.questions[id] = null;
    this.questionID.remove(id);
    return q;
  }

  // TODO: cancel context?

  insertAnswer(id: number): AnswerEntry<any> | null {
    if (this.answers[id]) {
      return null;
    }
    const a = new AnswerEntry(this, id);
    this.answers[id] = a;
    return a;
  }

  popAnswer(id: number): AnswerEntry<any> | null {
    const a = this.answers[id] ?? null;
    delete this.answers[id];
    return a;
  }

  shutdown(_err?: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.working = false;
    const err = _err ?? new Error("connection closed");

    for (let i = 0; i < this.questions.length; i++) {
      const q = this.questions[i];
      if (!q) {
        continue;
      }
      if (q.state === QuestionState.IN_PROGRESS) {
        q.reject(err);
      }
      this.questions[i] = null;
      this.questionID.remove(i);
    }

    for (const idStr of Object.keys(this.answers)) {
      const id = Number(idStr);
      const a = this.answers[id];
      a.done = true;
      a.err = err;
      a.deferred.reject(err);
      delete this.answers[id];
    }

    for (let i = 0; i < this.exports.length; i++) {
      const e = this.exports[i];
      if (!e) {
        continue;
      }
      try {
        e.client.close();
      } catch {
        // Safe to ignore: the export table entry is removed below, and shutdown has already made
        // the connection unreachable for further sends.
      }
      this.exports[i] = null;
      this.exportID.remove(i);
    }
    this.exportPromises = {};
    this.exportPromiseIndex = new WeakMap();

    for (const [idStr, entry] of Object.entries(this.imports)) {
      try {
        const c = entry.rc._client;
        if (c instanceof ImportClient) {
          c.closed = true;
          c.embargoQueue.rejectAll(err);
          c.resolved?.close();
          c.resolved = undefined;
          c.embargoId = undefined;
        }
      } catch {
        // Safe to ignore: the import table entry is removed below, so any cleanup failure cannot
        // leave a live connection-owned import.
      }
      delete this.imports[Number(idStr)];
    }

    for (const idStr of Object.keys(this.tailAnswerWaiters)) {
      const id = Number(idStr);
      const waiters = this.tailAnswerWaiters[id];
      for (const q of waiters) {
        if (q.state === QuestionState.IN_PROGRESS) {
          q.reject(err);
        }
      }
      delete this.tailAnswerWaiters[id];
    }

    for (const idStr of Object.keys(this.disembargoes)) {
      this.disembargoID.remove(Number(idStr));
    }
    this.disembargoes = {};
    this.transport.close();
  }

  call<P extends Struct, R extends Struct>(
    client: Client,
    call: Call<P, R>,
  ): Answer<R> {
    // TODO: this has a lot of complicated logic in the Go implementation
    // (lockedCall).
    // Some of it has to do with locking, which we don't need
    return client.call(call);
  }

  fillParams<P extends Struct, R extends Struct>(
    payload: Payload,
    cl: Call<P, R>,
  ): number[] {
    const params = placeParams(cl, payload.content);
    payload.content = params;
    this.makeCapTable(payload.segment, (length) =>
      payload._initCapTable(length),
    );
    return this.collectPayloadSenderHosted(payload);
  }

  makeCapTable(
    s: Segment,
    init: (length: number) => List<CapDescriptor>,
  ): void {
    const msgtab = s.message._capnp.capTable;
    if (!msgtab) {
      return;
    }
    const t = init(msgtab.length);
    for (const [i, client] of msgtab.entries()) {
      const desc = t.get(i);
      if (!client) {
        desc.none = true;
        continue;
      }
      this.descriptorForClient(desc, client as Client);
    }
  }

  collectPayloadSenderHosted(payload: Payload): number[] {
    const out: number[] = [];
    for (const desc of payload.capTable) {
      if (desc.which() === CapDescriptor.SENDER_HOSTED) {
        out.push(desc.senderHosted);
      }
    }
    return out;
  }

  fulfillTailAnswerWaiters(id: number, value: Pointer): void {
    const waiters = this.tailAnswerWaiters[id];
    if (!waiters) {
      return;
    }
    delete this.tailAnswerWaiters[id];
    for (const waiter of waiters) {
      waiter.fulfill(value);
    }
  }

  rejectTailAnswerWaiters(id: number, err: Error): void {
    const waiters = this.tailAnswerWaiters[id];
    if (!waiters) {
      return;
    }
    delete this.tailAnswerWaiters[id];
    for (const waiter of waiters) {
      waiter.reject(err);
    }
  }

  clientFromCapDescriptor(desc: CapDescriptor): Client {
    switch (desc.which()) {
      case CapDescriptor.SENDER_HOSTED: {
        return this.addImport(desc.senderHosted, false);
      }
      case CapDescriptor.SENDER_PROMISE: {
        return this.addImport(desc.senderPromise, true);
      }
      case CapDescriptor.RECEIVER_HOSTED: {
        const id = desc.receiverHosted;
        const e = this.findExport(id);
        if (!e) {
          throw protocolError(
            RpcProtocolErrorKind.UnknownExportId,
            format(RPC_UNKNOWN_EXPORT_ID, id),
          );
        }
        try {
          return e.rc.ref();
        } catch (error_) {
          throw protocolError(
            RpcProtocolErrorKind.UnknownExportId,
            (error_ as Error).message,
          );
        }
      }
      case CapDescriptor.RECEIVER_ANSWER: {
        const recvAns = desc.receiverAnswer;
        const id = recvAns.questionId;
        const a = this.answers[id];
        if (!a) {
          throw protocolError(
            RpcProtocolErrorKind.UnknownAnswerId,
            format(RPC_UNKNOWN_ANSWER_ID, id),
          );
        }
        return answerPipelineClient(
          a,
          promisedAnswerOpsToTransform(recvAns.transform),
        );
      }
      default: {
        throw protocolError(
          RpcProtocolErrorKind.UnknownCapDescriptor,
          format(RPC_UNKNOWN_CAP_DESCRIPTOR, desc.which()),
        );
      }
    }
  }

  discardResolvedCap(desc: CapDescriptor): void {
    switch (desc.which()) {
      case CapDescriptor.SENDER_HOSTED: {
        this.sendMessage(newReleaseMessage(desc.senderHosted, 1));
        return;
      }
      case CapDescriptor.SENDER_PROMISE: {
        this.sendMessage(newReleaseMessage(desc.senderPromise, 1));
        return;
      }
      case CapDescriptor.RECEIVER_HOSTED: {
        const id = desc.receiverHosted;
        if (!this.findExport(id)) {
          throw protocolError(
            RpcProtocolErrorKind.UnknownExportId,
            format(RPC_UNKNOWN_EXPORT_ID, id),
          );
        }
        return;
      }
      case CapDescriptor.RECEIVER_ANSWER: {
        const id = desc.receiverAnswer.questionId;
        if (!this.answers[id]) {
          throw protocolError(
            RpcProtocolErrorKind.UnknownAnswerId,
            format(RPC_UNKNOWN_ANSWER_ID, id),
          );
        }
        return;
      }
      case CapDescriptor.NONE: {
        throw protocolError(
          RpcProtocolErrorKind.UnknownCapDescriptor,
          format(RPC_UNKNOWN_CAP_DESCRIPTOR, desc.which()),
        );
      }
      default: {
        throw protocolError(
          RpcProtocolErrorKind.UnknownCapDescriptor,
          format(RPC_UNKNOWN_CAP_DESCRIPTOR, desc.which()),
        );
      }
    }
  }

  // descriptorForClient fills desc for client, adding it to the export
  // table if necessary.  The caller must be holding onto c.mu.
  descriptorForClient(desc: CapDescriptor, _client: Client): void {
    {
      dig: for (let client = _client; ; ) {
        // cf. https://sourcegraph.com/github.com/capnproto/go-capnproto2@e1ae1f982d9908a41db464f02861a850a0880a5a/-/blob/rpc/introspect.go#L113
        // TODO: fulfiller.EmbargoClient
        // TODO: embargoClient
        // TODO: queueClient
        // TODO: localAnswerClient
        if (client instanceof ImportClient) {
          if (client.conn !== this) {
            break dig;
          }
          desc.receiverHosted = client.id;
          return;
        } else if (client instanceof Ref) {
          client = client.client();
        } else if (client instanceof PipelineClient) {
          const p = client.pipeline;
          const ans = p.answer;
          const transform = p.transform();
          // TODO: fulfiller
          if (ans instanceof FixedAnswer) {
            let s: Struct | undefined;
            let err: Error | undefined;
            try {
              s = ans.structSync();
            } catch (error_) {
              err = error_ as Error;
            }
            client = clientFromResolution(transform, s, err);
          } else if (ans instanceof Question) {
            if (ans.state !== QuestionState.IN_PROGRESS) {
              client = clientFromResolution(transform, ans.obj, ans.err);
              continue;
            }
            if (ans.conn !== this) {
              const id = this.addExportPromise(ans, transform);
              desc.senderPromise = id;
              return;
            }
            const a = desc._initReceiverAnswer();
            a.questionId = ans.id;
            transformToPromisedAnswer(a, p.transform());
            return;
          } else {
            break dig;
          }
        } else {
          break dig;
        }
      }
    }

    const id = this.addExport(_client);
    desc.senderHosted = id;
  }

  addExportPromise(
    question: Question<any, any>,
    transform: PipelineOp[],
  ): number {
    const key = transform.map((op) => op.field).join(",");
    let indexed = this.exportPromiseIndex.get(question);
    if (!indexed) {
      indexed = new Map();
      this.exportPromiseIndex.set(question, indexed);
    }
    const existingId = indexed.get(key);
    if (existingId !== undefined) {
      const existing = this.findExport(existingId);
      if (existing) {
        existing.wireRefs++;
        return existingId;
      }
      indexed.delete(key);
    }

    const promiseClient = new PromiseExportClient();
    const id = this.addExport(promiseClient);
    indexed.set(key, id);
    if (this.exportPromises[id]) {
      return id;
    }
    this.exportPromises[id] = {
      settled: false,
      client: promiseClient,
    };
    const resolveFromQuestion = async () => {
      try {
        const obj = await question.struct();
        this.resolveExportPromiseCap(
          id,
          clientFromResolution(transform, obj, undefined),
        );
      } catch (error_) {
        this.resolveExportPromiseException(id, error_ as Error);
      }
    };
    void resolveFromQuestion();
    return id;
  }

  resolveExportPromiseCap(id: number, client: Client): void {
    const entry = this.exportPromises[id];
    if (!entry || entry.settled) {
      client.close();
      return;
    }
    entry.settled = true;
    entry.client.resolve(client);
    const m = newResolveMessage(id);
    this.descriptorForClient(m.resolve._initCap(), client);
    this.sendMessage(m);
  }

  resolveExportPromiseException(id: number, err: Error): void {
    const entry = this.exportPromises[id];
    if (!entry || entry.settled) {
      return;
    }
    entry.settled = true;
    entry.client.reject(err);
    const m = newResolveMessage(id);
    setResolveException(m.resolve, err);
    this.sendMessage(m);
  }

  sendMessage(msg: RPCMessage): void {
    this.transport.sendMessage(msg);
  }

  private async work() {
    this.working = true;
    while (this.working) {
      try {
        const m = await this.transport.recvMessage();
        this.handleMessage(m);
      } catch (error_) {
        if (error_ !== undefined) {
          throw error_;
        }
        this.working = false;
      }
    }
  }
}

interface Export {
  id: number;
  rc: RefCount;
  client: Client;
  wireRefs: number;
}

export interface ImportEntry {
  rc: RefCount;
  refs: number;
  isPromise: boolean;
}

interface ExportPromiseEntry {
  settled: boolean;
  client: PromiseExportClient;
}

export function answerPipelineClient<T extends Struct>(
  a: AnswerEntry<T>,
  transform: PipelineOp[],
): Client {
  return new LocalAnswerClient(a, transform);
}
