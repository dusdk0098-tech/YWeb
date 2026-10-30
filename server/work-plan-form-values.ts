// Plain shared values/types only: browser form controls do not import validation/print engines.
export type PlanMeasurement={value:string|null;unit:''|'m'|'mm'|'t';basis:string};
export type PlanResponse={state:null|'provided'|'not_applicable';note:string};
export const riskNames={fall:'추락',fallingObject:'낙하',overturn:'전도/전락',caught:'협착',collapse:'붕괴',other:'기타'} as const;
export type PlanCargo={description:string;length:PlanMeasurement;height:PlanMeasurement;width:PlanMeasurement;unitMass:PlanMeasurement;otherMass:PlanMeasurement};
type Common={schemaVersion:1;terrain:PlanResponse;groundwater:PlanResponse;route:PlanResponse;measures:Record<keyof typeof riskNames,PlanResponse>};
export type PlanForm=Common&({kind:'general_machine';equipmentMass:PlanMeasurement}|{kind:'excavator_lift';radius:PlanMeasurement;liftHeight:PlanMeasurement;ratedLoad:PlanMeasurement;cargo:PlanCargo[]});
export function blankMeasurement():PlanMeasurement{return {value:null,unit:'',basis:''};}
export function blankCargo():PlanCargo{return {description:'',length:blankMeasurement(),height:blankMeasurement(),width:blankMeasurement(),unitMass:blankMeasurement(),otherMass:blankMeasurement()};}
export function blankPlanForm(kind:PlanForm['kind']):PlanForm{
 const blank=():PlanResponse=>({state:null,note:''});
 const base={schemaVersion:1 as const,terrain:blank(),groundwater:blank(),route:blank(),measures:{fall:blank(),fallingObject:blank(),overturn:blank(),caught:blank(),collapse:blank(),other:blank()}};
 return kind==='general_machine'?{...base,kind,equipmentMass:blankMeasurement()}:{...base,kind,radius:blankMeasurement(),liftHeight:blankMeasurement(),ratedLoad:blankMeasurement(),cargo:[]};
}
export const planFormName=(form:PlanForm)=>form.kind==='general_machine'?'차량계·중량물 일반 입력형식':'굴착기 중량물 취급 입력형식';
