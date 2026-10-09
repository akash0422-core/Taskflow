import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
const BASE=(process.env.EXPO_PUBLIC_API_URL||'https://taskflow-fullstack-uruq.onrender.com/api').replace(/\/$/,'');
export const getToken=()=>SecureStore.getItemAsync('taskflow_token');
export const setToken=(token)=>SecureStore.setItemAsync('taskflow_token',token);
export const clearToken=()=>SecureStore.deleteItemAsync('taskflow_token');
export async function request(path,options={}){const token=options.token??await getToken();let response;const isFormData=typeof FormData!=='undefined'&&options.body instanceof FormData;try{response=await fetch(`${BASE}${path}`,{...options,headers:{...(isFormData?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})}});}catch{throw new Error('No network connection. Check your internet and try again.');}if(response.status===204)return null;const body=await response.json().catch(()=>({}));if(!response.ok){const error=new Error(body.error||'Request failed.');error.status=response.status;throw error;}return body;}
export async function downloadAttachment(attachment,token){const safeName=attachment.name.replace(/[^a-zA-Z0-9._-]/g,'_');const destination=`${FileSystem.cacheDirectory}${Date.now()}-${safeName}`;const result=await FileSystem.downloadAsync(`${BASE}/attachments/${attachment.id}/download`,destination,{headers:{Authorization:`Bearer ${token}`}});if(result.status<200||result.status>=300)throw new Error('Unable to download attachment.');await Sharing.shareAsync(result.uri,{mimeType:attachment.mimeType,dialogTitle:attachment.name});}
