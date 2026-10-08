import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
const BASE=(process.env.EXPO_PUBLIC_API_URL||'https://taskflow-fullstack-uruq.onrender.com/api').replace(/\/$/,'');
export const getToken=()=>SecureStore.getItemAsync('taskflow_token');
export const setToken=(token)=>SecureStore.setItemAsync('taskflow_token',token);
export const clearToken=()=>SecureStore.deleteItemAsync('taskflow_token');
export async function request(path,options={}){const token=options.token??await getToken();let response;try{response=await fetch(`${BASE}${path}`,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}});}catch{throw new Error('No network connection. Check your internet and try again.');}if(response.status===204)return null;const body=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(body.error||'Request failed.');error.status=response.status;throw error;}return body;}
