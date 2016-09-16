#prod env vars to metadata
gcloud compute project-info add-metadata --metadata-from-file env=./prod.env

#postgres
gcloud compute --project "peaceful-parity-87002" disks create "disk-postgres" --size "100" --zone "us-central1-b" --type "pd-ssd"
gcloud compute instances delete -q postgres-1
gcloud compute instances create postgres-1 --machine-type n1-highmem-2 --image-family ubuntu-1404-lts --image-project ubuntu-os-cloud --disk name=disk-postgres-2 --boot-disk-size 10GB --boot-disk-type pd-ssd
gcloud compute instances add-metadata postgres-1 --metadata-from-file startup-script=./scripts/postgres.sh

#redis
gcloud compute --project "peaceful-parity-87002" disks create "disk-redis" --size "50" --zone "us-central1-b" --type "pd-ssd"
gcloud compute instances delete -q redis-1
gcloud compute instances create redis-1 --machine-type n1-highmem-4 --image-family ubuntu-1404-lts --image-project ubuntu-os-cloud --disk name=disk-redis --boot-disk-size 10GB --boot-disk-type pd-ssd
gcloud compute instances add-metadata redis-1 --metadata-from-file startup-script=./scripts/redis.sh

#cassandra
gcloud compute --project "peaceful-parity-87002" disks create "disk-cassandra-4" --size "2000" --zone "us-central1-b" --type "pd-standard"
gcloud compute instances delete -q cassandra-4
gcloud compute instances create cassandra-4 --machine-type n1-highmem-4 --image-family ubuntu-1404-lts --image-project ubuntu-os-cloud --boot-disk-size 10GB --boot-disk-type pd-ssd --disk "name=disk-cassandra-4,device-name=persistent-disk-1" 
gcloud compute instances add-metadata cassandra-4 --metadata-from-file startup-script=./scripts/cassandra.sh

#web, health check, loadbalancer
gcloud compute forwarding-rules delete -q lb-rule
gcloud compute target-pools delete -q lb-pool
gcloud compute http-health-checks delete -q lb-check
gcloud compute instance-groups managed delete -q web-group-1
gcloud compute instance-templates delete -q web-1
gcloud compute instance-templates create web-1 --machine-type g1-small --image-family ubuntu-1404-lts --image-project ubuntu-os-cloud --boot-disk-size 10GB --boot-disk-type pd-ssd --tags "http-server" --metadata-from-file startup-script=./scripts/web.sh
gcloud compute instance-groups managed create "web-group-1" --base-instance-name "web-group-1" --template "web-1" --size "0"
gcloud compute --project "peaceful-parity-87002" http-health-checks create "lb-check" --port "80" --request-path "/healthz" --check-interval "5" --timeout "5" --unhealthy-threshold "2" --healthy-threshold "2"
gcloud compute --project "peaceful-parity-87002" target-pools create "lb-pool" --region "us-central1" --health-check "lb-check" --session-affinity "NONE"
gcloud compute --project "peaceful-parity-87002" forwarding-rules create "lb-rule" --region "us-central1" --address "104.197.19.32" --ip-protocol "TCP" --port-range "80" --target-pool "lb-pool"
gcloud compute --project "peaceful-parity-87002" instance-groups managed set-target-pools "web-group-1" --zone "us-central1-b" --target-pools "https://www.googleapis.com/compute/v1/projects/peaceful-parity-87002/regions/us-central1/targetPools/lb-pool"
gcloud compute instance-groups managed set-autoscaling "web-group-1" --cool-down-period "60" --max-num-replicas "10" --min-num-replicas "2" --target-cpu-utilization "0.8"

#backend
gcloud compute instance-groups managed delete -q backend-group-1
gcloud compute instance-templates delete -q backend-1
gcloud compute instance-templates create backend-1 --machine-type n1-highcpu-4 --image-family ubuntu-1404-lts --image-project ubuntu-os-cloud --preemptible --boot-disk-size 10GB --boot-disk-type pd-ssd --tags "http-server" --metadata-from-file startup-script=./scripts/backend.sh
gcloud compute instance-groups managed create "backend-group-1" --base-instance-name "backend-group-1" --template "backend-1" --size "1"
gcloud compute instance-groups managed set-autoscaling "backend-group-1" --cool-down-period "60" --max-num-replicas "1" --min-num-replicas "1" --target-cpu-utilization "0.6"

#parsers
gcloud compute instance-groups managed delete -q parser-group-1
gcloud compute instance-templates delete -q parser-1
gcloud compute instance-templates create parser-1 --machine-type n1-highcpu-2 --image-family ubuntu-1404-lts --image-project ubuntu-os-cloud --preemptible --boot-disk-size 10GB --boot-disk-type pd-ssd --metadata-from-file startup-script=./scripts/parser.sh
gcloud compute instance-groups managed create "parser-group-1" --base-instance-name "parser-group-1" --template "parser-1" --size "1"
gcloud compute instance-groups managed set-autoscaling "parser-group-1" --cool-down-period "60" --max-num-replicas "30" --min-num-replicas "3" --target-cpu-utilization "0.8"