import {acceptAgentProposal,type AgentRequestContext} from '../../../packages/domain/src/agent-request.js';
/** Composition boundary. Authenticated HTTP ingress supplies this trusted context,
 * never JSON fields for sessions, policy, markets or provider configuration.
 * No provider SDK/runtime is configured by default. No transaction signer exists. */
export class AgentProposalService {
 constructor(private readonly context:()=>AgentRequestContext){}
 status(){const c=this.context();return {status:c.provider.configured?'CONFIGURED_INGRESS':'NOT_CONFIGURED',autonomousRuntime:'NOT_IMPLEMENTED',execution:'NOT_IMPLEMENTED'} as const;}
 propose(input:unknown){return acceptAgentProposal(input,this.context());}
}
