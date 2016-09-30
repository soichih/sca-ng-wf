(function() {
'use strict';

var wf = angular.module('sca-ng-wf', [
    'ngFileUpload', //for scaWfUploader
    'sca-product-raw', //to display files for each task deps
    'toaster',
]);

//load tasks (and progress status) and refreshes preriodically
wf.factory('scaTask', function(appconf, $http, $interval, toaster) {
  
    //tasks that we are keeping up with
    var tasks = {};
    function load(taskid) {
        return $http.get(appconf.wf_api+'/task/', {params: {
            find: {_id: taskid},
        }}).then(function(res) {
            var _task = res.data.tasks[0];
            for(var k in _task) tasks[taskid][k] = _task[k]; //do inplace update
            delete tasks[taskid].loading;
        }, function(res) {
            if(res.data && res.data.message) toaster.error(res.data.message);
            else toaster.error(res.statusText);
        });
    }

    //reload tasks
    console.log("sca-ng-wf scaTask -- starting interval");
    var reload_interval = $interval(function() {
        //console.dir(tasks);
        var ids = Object.keys(tasks);
        var find = {_id: {$in: ids}};
        $http.get(appconf.wf_api+'/task/', {params: {find: find}}).then(function(res) {
            res.data.tasks.forEach(function(task) {
                var taskid = task._id;
                for(var k in task) tasks[taskid][k] = task[k]; //do inplace update
            });
        }, function(res) {
            //TODO should I retry later instead of canceling for good?
            $interval.cancel(reload_interval);

            if(res.data && res.data.message) toaster.error(res.data.message);
            else toaster.error(res.statusText);
        });
    }, 2500);

    function load_progress(task) {
        //ok.. load progress status
        $http.get(appconf.progress_api+'/status/'+task.progress_key).then(function(res) {
            task._progress = res.data;
        }, function(res) {
            if(res.data && res.data.message) toaster.error(res.data.message);
            else toaster.error(res.statusText);
        });
    }

    //reload progress
    $interval(function() {
        //console.dir(tasks);
        for(var taskid in tasks) {
            var task = tasks[taskid];

            if(!task.progress_key) {
                //no key, no progress
                //task._progress = null;
                continue; 
            }
            if(task.status == "finished" || task.status == "failed" || task.status == "stopped") {
                //if finished, no need to load progress
                task._progress = null; //I need to clear this so that proress will be reloaded when rerun (TODO need to test this case)
                continue; 
            }
            if(task._progress && task._progress.status == "finished") {
                //if progress is finished, no need to load again
                //task._progress = null; //this causes flickering of task<>progress status because progress tends to finish before task
                continue; 
            }

            load_progress(task);
        }
    }, 1000);

    return {
        get: function(taskid) {
            if(tasks[taskid]) return tasks[taskid];
            var task = {loading: true};
            tasks[taskid] = task;
            task._promise = load(taskid);
            return task;
        }
    }
});

//load resource info
wf.factory('scaResource', function(appconf, $http, $interval, toaster) {
    var resources = {}; //cache

    function load(resourceid) {
        return $http.get(appconf.wf_api+'/resource/', {params: {
            find: {_id: resourceid},
        }}).then(function(res) {
            var _resource = res.data.resources[0];
            for(var k in _resource) resources[resourceid][k] = _resource[k]; //do inplace update
            delete resources[resourceid].loading;
        }, function(res) {
            if(res.data && res.data.message) toaster.error(res.data.message);
            else toaster.error(res.statusText);
        });
    }

    return {
        get: function(resourceid) {
            if(resources[resourceid]) return resources[resourceid];
            var resource = {loading: true};
            resources[resourceid] = resource;
            resource._promise = load(resourceid); 
            return resource;
        }
    }
});

//displays task status, and if there is any dependencies, displays that as well
wf.directive('scaWfTaskdeps', function(appconf, $http, toaster, $interval, scaTask) {
    return {
        restrict: 'E',
        //transclude: true,
        scope: {
            taskid: '<', 
        },
        templateUrl: 'node_modules/sca-ng-wf/t/deps.html',  //TODO - should make this configurable..
        link: function ($scope, element) {
            //$scope.show_debug = {}; //contains task ids to show details
            $scope.task = scaTask.get($scope.taskid);
            $scope.appconf = appconf;

            //$scope.resource = null;
            $scope.tasks = null;
                      
            //load all deps tasks (once task.deps is loaded)
            $scope.task._promise.then(function() {
                //only need to do once.. scaTask will refresh them
                if(!$scope.tasks) {
                    $scope.tasks = [];
                    load_deps($scope.task);
                }
            });
            $scope.stop = function(task) {
                $http.put(appconf.wf_api+"/task/stop/"+task._id)
                .then(function(res) {
                    toaster.success("Requested to stop this task");
                }, function(res) {
                    if(res.data && res.data.message) toaster.error(res.data.message);
                    else toaster.error(res.statusText);
                });
            }

            $scope.rerun = function(task) {
                $http.put(appconf.wf_api+"/task/rerun/"+task._id)
                .then(function(res) {
                    toaster.success("Requested to rerun this task");
                    //start_loading();
                }, function(res) {
                    if(res.data && res.data.message) toaster.error(res.data.message);
                    else toaster.error(res.statusText);
                });
            }

            function load_deps(task) {
                if(task.deps) task.deps.forEach(function(dep_id) {
                    var dep = scaTask.get(dep_id);
                    dep._promise.then(function() {
                        load_deps(dep);
                    });
                });
                $scope.tasks.unshift(task); 
            }
        }
    };
});

wf.directive('scaWfUploader', ['appconf', 'toaster', 'Upload', '$http', 
function(appconf, toaster, Upload, $http ) {
    return {
        //restrict: 'E',
        scope: {
            instid: '<',
            taskid: '<',
            files: '=',
        }, 
        templateUrl: 'node_modules/sca-ng-wf/t/uploader.html', //TODO should be made configurable somehow
        link: function(scope, element) {
            scope.loaded = false;

            scope.files_uploading = [];
            scope.files = [];

            //first find the best resource to upload files to
            scope.best_resource = null;
            $http.get(appconf.wf_api+"/resource/best", {params: {
                service: "_upload",
            }})    
            .then(function(res) {
                if(!res.data.resource) return; //no need to go further..
                scope.best_resource = res.data;
                //scope.path = scope.best_resource.workdir+"/"+scope.instid+"/"+scope.taskid,
                scope.path = scope.instid+"/"+scope.taskid,
                
                //then download files that are already uploaded to the resource
                $http.get(appconf.wf_api+"/resource/ls/"+scope.best_resource.resource._id, {params: {
                    //resource_id: scope.best_resource.resource._id,
                    path: scope.path,
                }})    
                .then(function(res) {
                    scope.loaded = true;
                    scope.files = res.data.files;
                }, function(res) {
                    scope.loaded = true;
                    if(res.data && res.data.code && res.data.code == 2) {
                        console.log("upload directory doesn't exist yet, but that's ok");
                        scope.files = [];
                        return;
                    }
                    if(res.data && res.data.message) toaster.error(res.data.message);
                    else toaster.error(res.statusText);
                });
            }, function(res) {
                if(res.data && res.data.message) toaster.error(res.data.message);
                else toaster.error(res.statusText);
            });

            //handles the actual file upload to the best resource found
            scope.uploadFiles = function(files) {
                files.forEach(function(file) {
                    //make sure the same name already exist
                    var duplicate = false;
                    scope.files.forEach(function(_file) {
                        if(_file.filename == file.name) duplicate = true;
                    });
                    if(duplicate) {
                        toaster.warning(file.name+" already exists. Please delete the original file");
                        return;
                    }

                    scope.files_uploading.push(file);

                    //file Upload can only use multi-part upload (instead of a simpler streaming version)
                    file.upload = Upload.upload({
                        url: appconf.wf_api+"/resource/upload",
                        data: {
                            resource_id: scope.best_resource.resource._id,
                            path: scope.instid+"/"+scope.taskid,
                            file: file, 
                        }
                    });
                    file.upload.then(function(res) {
                        file.complete = true;
                        scope.files.push(res.data.file);
                        scope.$emit("file_uploaded", res.data.file);
                    }, function(res) {
                        if(res.data && res.data.message) toaster.error(res.data.message);
                        else if(res.status == -1) toaster.error("Upload canceled");
                        else toaster.error(res.statusText);
                        file.failed = true;
                        file.progress = 0;
                    }, function(event) {
                        if(event.loaded && event.total) file.progress = parseInt(100.0 * event.loaded / event.total);
                        else file.progress = 0;
                    });
                });
            }
            scope.remove = function(file) {
                var idx = scope.files.indexOf(file);
                scope.files.splice(idx, 1);
                $http.delete(appconf.wf_api+"/resource/file", {params: {
                    resource_id: scope.best_resource.resource._id,
                    path: scope.instid+"/"+scope.taskid+"/"+file.filename,
                }})    
                .then(function(res) {
                    //console.dir(res.data);
                    //no news is good news
                }, function(res) {
                    if(res.data && res.data.message) toaster.error(res.data.message);
                    else toaster.error(res.statusText);
                });
                
            }
            scope.download = function(file) {
                var jwt = localStorage.getItem(appconf.jwt_id);
                var path = scope.instid+"/"+scope.taskid+"/"+file.filename;
                var url = appconf.wf_api+"/resource/download?r="+scope.best_resource.resource._id+"&p="+path+"&at="+jwt;
                window.open(url, "_blank");
                //window.location = url;
                console.log("download");
            }
            scope.cancel = function(file) {
                file.upload.abort();
                var idx = scope.files_uploading.indexOf(file);
                scope.files_uploading.splice(idx, 1);
            }
        }
    };
}]);

//task summary
wf.directive('scaWfTasksum', ['appconf', 'toaster', '$http',
function(appconf, toaster, $http) {
    return {
        scope: {
            task: '=',
        }, 
        transclude: true,
        templateUrl: 'node_modules/sca-ng-wf/t/tasksum.html', //TODO should be made configurable somehow
        link: function(scope, element) {
            scope.appconf = appconf;
        }
    };
}]);

//show user-friendly file sizes
wf.filter('bytes', function() {
    return function(bytes, precision) {
        if (isNaN(parseFloat(bytes)) || !isFinite(bytes)) return '-';
        if (typeof precision === 'undefined') precision = 1;
        var units = ['bytes', 'kB', 'MB', 'GB', 'TB', 'PB'],
            number = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, Math.floor(number))).toFixed(precision) +  ' ' + units[number];
    }
});

}()); //immediate function invocation

