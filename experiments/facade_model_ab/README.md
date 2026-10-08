# GeoCalib + DeepLSD Facade A/B Experiment

This experiment compares the existing single-global-H0 plus constrained-mesh
baseline with optional GeoCalib and DeepLSD inputs. It does not change the
production facade upload or GLB generation path.

## Windows environment

The real-model matrix uses the existing CUDA environment:

```powershell
E:\anaconda3\envs\building_sam2\python.exe -m experiments.facade_model_ab.run_real_matrix `
  --samples-root rural_house_generator\runtime_storage\facade_layering `
  --output-root rural_house_generator\runtime_storage\facade_model_ab
```

Unit tests contain no model imports or downloads:

```powershell
E:\anaconda3\envs\building_facade_pilot\python.exe -m pytest experiments\facade_model_ab -q
```

Model repositories and weights belong under
`rural_house_generator/runtime_storage/model_repos` and
`rural_house_generator/runtime_storage/model_weights`. The real runner records
repository commits, checkpoint SHA-256 values, byte sizes, CUDA availability,
runtime, and peak CUDA memory in its report.

## Linux

Use Python 3.10 and an NVIDIA PyTorch CUDA image. Install
`linux-requirements.txt`, then install the recorded GeoCalib and DeepLSD source
commits in editable mode. Mount model repositories and weights read-only and
write results to a runtime volume. The first trial uses DeepLSD inference only;
it does not compile the optional Ceres line-refinement extension.

The adapters automatically fall back to the baseline when a dependency,
checkpoint, calibration validation, or derived geometry is unavailable.

