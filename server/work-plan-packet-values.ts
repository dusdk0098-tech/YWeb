export const packetKinds={operator_license:'조종사 면허 관련',registration:'장비 등록 관련',inspection:'검사 관련',insurance:'보험 관련',basic_education:'기초 교육 관련',operator_education:'조종사 교육 관련',special_education:'특별 교육 관련',rated_load_chart:'정격하중표',nondestructive_test:'비파괴 검사 관련',safety_certificate:'안전 인증 관련',qualification_training:'자격 교육 관련',other:'기타'} as const;
export type PacketKind=keyof typeof packetKinds;
export type PacketRow={kind:PacketKind;state:null|'linked'|'missing'|'not_applicable';fileId:string|null;note:string};
export type PlanPacket={schemaVersion:1;equipmentId:string|null;rows:PacketRow[]};
export function blankPacket():PlanPacket{return {schemaVersion:1,equipmentId:null,rows:[]};}
export function resetPacket(packet:PlanPacket):PlanPacket{return {...packet,rows:packet.rows.map(row=>({...row,state:null,fileId:null,note:''}))};}
