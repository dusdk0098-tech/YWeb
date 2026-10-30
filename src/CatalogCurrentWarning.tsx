import {useEffect,useState} from "react";
import {api} from "./api";
import {CatalogUseNotice,type CatalogUseStatus} from "./CatalogUseNotice";
export function CatalogCurrentWarning({path,disabled}:{path:string;disabled:boolean}){
 const [state,setState]=useState<CatalogUseStatus|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[tick,setTick]=useState(0);
 useEffect(()=>{let live=true;setLoading(true);setState(null);setError("");api<{current:CatalogUseStatus|null}>(path+"/catalog-use-status").then(v=>{if(live)setState(v.current);}).catch(e=>{if(live)setError(e.message);}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[path,tick]);
 return <section><h3>출처의 현재 상태 조회</h3>{loading?<p>현재 상태 조회 중 · 과거 보관본과 별도입니다.</p>:error?<p role="alert">현재 상태 조회 실패: {error} · 정상/사용가능으로 추정하지 않습니다.</p>:state?<CatalogUseNotice state={state}/>:<p>카탈로그 출처 없음</p>}<button disabled={disabled||loading} onClick={()=>setTick(t=>t+1)}>현재 출처 상태 다시 조회</button></section>;
}
