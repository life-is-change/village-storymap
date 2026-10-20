from test_unified_deployment import module
import pytest
def test_missing_incompatible_or_stale_worker_proof_never_enables_real_bridge():
 m=module()
 for proof in [{},{'bridge_protocol':1,'instanceId':'aliyun-test','workers':{}},{'bridge_protocol':1,'instanceId':'other','workers':{}}]:
  with pytest.raises(ValueError,match='WORKER_COMPATIBILITY_REQUIRED'):m.validate_worker_readiness(proof,'aliyun-test',now=1000)
 proof={'bridge_protocol':1,'instanceId':'aliyun-test','workers':{'geoprocessing':{'version':'geo-aliyun-bridge-v1','seen_at':999},'facade':{'version':'facade-aliyun-bridge-v1','seen_at':999}}}
 assert m.validate_worker_readiness(proof,'aliyun-test',now=1000) is True
 proof['workers']['facade']['seen_at']=800
 with pytest.raises(ValueError):m.validate_worker_readiness(proof,'aliyun-test',now=1000)
