#!/bin/bash
export VK_ICD_FILENAMES=/etc/vulkan/icd.d/nvidia_icd.json
google-chrome --enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan https://webloteria.vercel.app
