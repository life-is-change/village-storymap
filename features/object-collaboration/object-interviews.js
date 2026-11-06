(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ObjectInterviewsModule=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function validate(input){
    if(!input?.objectCode||!input?.layerKey)throw Error('请先选择地图上的矢量对象。');
    if(!input.interviewedAt||!Number.isFinite(Date.parse(input.interviewedAt)))throw Error('请填写访谈时间。');
    if(!String(input.interviewee||'').trim()||input.interviewee.length>100)throw Error('请填写访谈对象，最多100字。');
    if(!String(input.content||'').trim()||input.content.length>5000)throw Error('请填写访谈内容，最多5000字。');
    return {...input,interviewedAt:new Date(input.interviewedAt).toISOString(),interviewee:input.interviewee.trim(),content:input.content.trim()};
  }
  function render({records=[],canSubmit=false,loadFailed=false,blockedMessage='登录并取得当前空间编辑权限后可提交访谈。'}={}){
    const now=new Date();const local=new Date(now-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
    return `<section class="info-card object-interviews-card"><h3 class="house-title">访谈信息</h3>
      ${canSubmit?`<form id="objectInterviewForm" class="object-interview-form">
        <label>访谈时间<input name="interviewedAt" type="datetime-local" value="${local}" required></label>
        <label>访谈对象<input name="interviewee" type="text" maxlength="100" placeholder="例如：村民、摊主" required></label>
        <label>访谈内容<textarea name="content" rows="4" maxlength="5000" required></textarea></label>
        <button type="submit">提交访谈</button><p data-interview-status role="status"></p>
      </form>`:`<p class="object-comment-empty">${escape(blockedMessage)}</p>`}
      <div class="object-interview-list">${loadFailed?'<p role="status">访谈记录暂时加载失败，请重新选择对象重试。</p>':records.length?records.map(r=>`<article class="object-interview-record"><div><strong>${escape(r.interviewee)}</strong><time>${escape(new Date(r.interviewed_at).toLocaleString('zh-CN'))}</time></div><p>${escape(r.content)}</p><small>记录人：${escape(r.author_name||'同学')}</small></article>`).join(''):'<p class="object-comment-empty">暂无该要素的访谈记录。</p>'}</div></section>`;
  }
  return {validate,render};
});
